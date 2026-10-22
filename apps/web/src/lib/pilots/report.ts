import { z } from "zod";
import { checkLabel, reasonLabel } from "@/lib/format";
import { flaggedMoments, momentClock, videoDuration, type StoredCheck, type TimelineReason } from "@/lib/timeline";

// Shadow-mode pilot report (issue #65): Ormes ran next to the collector's own reviewers on videos
// they had already judged. Everything is measured against those reviewers' decisions, and against
// the lab's outcome where the collector knows it.

/** Review time per video when the CSV does not say (same assumption as the overview). */
export const DEFAULT_REVIEW_MINUTES = 3;

// ---------------------------------------------------------------- criteria

export const METRICS = {
  review_minutes_change: {
    label: "Review minutes per video-hour",
    unit: "change",
    help: "Change in review time per hour of footage when people only review what Ormes sends to review.",
  },
  false_accept_rate: {
    label: "False accepts",
    unit: "rate",
    help: "Share of the videos your reviewers rejected that Ormes accepted on its own.",
  },
  false_reject_rate: {
    label: "False rejects",
    unit: "rate",
    help: "Share of the videos your reviewers accepted that Ormes rejected on its own.",
  },
  rejection_precision: {
    label: "Precision on rejections",
    unit: "rate",
    help: "Of the videos Ormes rejected, the share your reviewers also rejected.",
  },
  rejection_recall: {
    label: "Recall on rejections",
    unit: "rate",
    help: "Of the videos your reviewers rejected, the share Ormes rejected or sent to review.",
  },
  automatic_rate: {
    label: "Decided without a person",
    unit: "rate",
    help: "Share of videos Ormes accepted or rejected without sending them to review.",
  },
} as const;
export type MetricKey = keyof typeof METRICS;

const metricKey = z.enum(Object.keys(METRICS) as [MetricKey, ...MetricKey[]]);

export const criterionSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("threshold"),
    metric: metricKey,
    op: z.enum(["<=", ">="]),
    /** Rates in 0..1; review_minutes_change in -1..1 (e.g. -0.4 for "-40%"). */
    value: z.number().min(-1).max(1),
  }),
  z.object({
    /** With Ormes (and people resolving its review cases), false accepts against the lab's outcome are no higher than today's reviewers'. */
    kind: z.literal("false_accepts_vs_lab_not_above_reviewers"),
  }),
]);
export type Criterion = z.infer<typeof criterionSchema>;
export const criteriaSchema = z.array(criterionSchema).min(1, "Add at least one success criterion").max(8);

export const DEFAULT_CRITERIA: Criterion[] = [
  { kind: "threshold", metric: "review_minutes_change", op: "<=", value: -0.4 },
  { kind: "false_accepts_vs_lab_not_above_reviewers" },
];

const pct = (x: number) => `${Math.round(x * 1000) / 10}%`;
const signedPct = (x: number) => `${x > 0 ? "+" : x < 0 ? "−" : ""}${pct(Math.abs(x))}`;

export function describeCriterion(c: Criterion): string {
  if (c.kind === "false_accepts_vs_lab_not_above_reviewers") return "False accepts against lab outcomes no higher than your reviewers' current rate";
  const m = METRICS[c.metric];
  const value = m.unit === "change" ? signedPct(c.value) : pct(c.value);
  const word = c.op === "<=" ? "at most" : "at least";
  return `${m.label}: ${word} ${value}`;
}

// ---------------------------------------------------------------- inputs

export type PilotItemIn = {
  external_id: string;
  reviewer_decision: "accept" | "reject";
  reviewer_minutes: number | null;
  lab_outcome: "accept" | "reject" | null;
  contributor_ref: string | null;
  video_id: string | null;
};
export type PilotVideoIn = { id: string; status: string; duration_s: number | null; contributor_ref: string | null };
export type PilotDecisionIn = { video_id: string; decision: string; reasons: unknown; checks: unknown; created_at: string };

// ---------------------------------------------------------------- report

export type Verdict = "pass" | "fail" | "not_measurable";
export type CriterionResult = {
  criterion: Criterion;
  description: string;
  actual: number | null;
  /** For the vs-lab criterion: the reviewers' rate it is compared with. */
  baseline: number | null;
  verdict: Verdict;
  detail: string;
};

export type Disagreement = {
  external_id: string;
  video_id: string;
  kind: "false_accept" | "false_reject";
  reviewer: "accept" | "reject";
  ormes: "accept" | "reject";
  reasons: string[];
  moments: { t: string | null; label: string; detail: string }[];
};

export type Duplicate = { external_id: string; video_id: string; contributor_ref: string | null; matched_video_id: string; matched_contributor_ref: string | null; same_contributor: boolean | null; similarity: number | null };

export type CheckAgreement = {
  check: string;
  label: string;
  /** Videos your reviewers rejected on which this check failed or was uncertain. */
  flagged_on_rejected: number;
  rejected: number;
  /** Videos your reviewers accepted on which this check failed or was uncertain (false alarms). */
  flagged_on_accepted: number;
  accepted: number;
};

export type PilotReport = {
  generated_at: string;
  status: "running" | "complete";
  verdict: "pass" | "fail" | "not_measurable" | "provisional";
  counts: { videos: number; decided: number; pending: number; failed: number; missing_file: number };
  confusion: Record<"accept" | "reject" | "review", Record<"accept" | "reject", number>>;
  metrics: Record<MetricKey, number | null> & {
    reviewer_reject_rate: number | null;
    agreement: number | null;
  };
  minutes: { before: number; after: number; saved: number; footage_hours: number; per_hour_before: number | null; per_hour_after: number | null; assumed_minutes: number };
  lab: {
    videos: number;
    reviewer_false_accept_rate: number | null;
    reviewer_false_reject_rate: number | null;
    with_ormes_false_accept_rate: number | null;
    with_ormes_false_reject_rate: number | null;
  };
  criteria: CriterionResult[];
  checks: CheckAgreement[];
  duplicates: { across_contributors: number; same_contributor: number; unknown: number; items: Duplicate[] };
  disagreements: Disagreement[];
  rows: {
    external_id: string;
    video_id: string | null;
    reviewer_decision: "accept" | "reject";
    ormes_decision: "accept" | "reject" | "review" | null;
    status: string;
    lab_outcome: "accept" | "reject" | null;
    reviewer_minutes: number;
    duration_s: number | null;
    reasons: string[];
  }[];
};

const ratio = (n: number, d: number) => (d ? n / d : null);
const CHECK_ORDER = ["task_completed", "hands_visible", "framing", "technical", "privacy", "originality"];

function latestBy<T extends { video_id: string; created_at: string }>(rows: T[]): Map<string, T> {
  const out = new Map<string, T>();
  for (const r of rows) {
    const cur = out.get(r.video_id);
    if (!cur || r.created_at > cur.created_at) out.set(r.video_id, r);
  }
  return out;
}

export function computePilotReport(input: {
  items: PilotItemIn[];
  videos: PilotVideoIn[];
  decisions: PilotDecisionIn[];
  /** Every video of the org a duplicate may point at: id → contributor. */
  contributors?: Map<string, string | null>;
  criteria: Criterion[];
  defaultMinutes?: number | null;
  now?: number;
}): PilotReport {
  const videos = new Map(input.videos.map((v) => [v.id, v]));
  const decisions = latestBy(input.decisions);
  const given = input.items.map((i) => i.reviewer_minutes).filter((m): m is number => m !== null);
  const assumed = input.defaultMinutes ?? (given.length ? given.reduce((a, b) => a + b, 0) / given.length : DEFAULT_REVIEW_MINUTES);

  const confusion = {
    accept: { accept: 0, reject: 0 },
    reject: { accept: 0, reject: 0 },
    review: { accept: 0, reject: 0 },
  };
  const counts = { videos: input.items.length, decided: 0, pending: 0, failed: 0, missing_file: 0 };
  const minutes = { before: 0, after: 0, footageSeconds: 0, footageKnown: true };
  const lab = { videos: 0, labRejects: 0, labAccepts: 0, reviewerFA: 0, reviewerFR: 0, ormesFA: 0, ormesFR: 0 };
  const checks = new Map<string, CheckAgreement>();
  const duplicates: Duplicate[] = [];
  const disagreements: Disagreement[] = [];
  const rows: PilotReport["rows"] = [];

  for (const item of input.items) {
    const video = item.video_id ? videos.get(item.video_id) : undefined;
    const d = item.video_id ? decisions.get(item.video_id) : undefined;
    const ormes = d && (d.decision === "accept" || d.decision === "reject" || d.decision === "review") ? d.decision : null;
    const itemMinutes = item.reviewer_minutes ?? assumed;
    const reasons = Array.isArray(d?.reasons) ? (d.reasons as TimelineReason[]) : [];
    const storedChecks = d?.checks && typeof d.checks === "object" ? (d.checks as Record<string, StoredCheck>) : {};
    rows.push({
      external_id: item.external_id,
      video_id: item.video_id,
      reviewer_decision: item.reviewer_decision,
      ormes_decision: ormes,
      status: !video ? "missing_file" : ormes ? "decided" : video.status,
      lab_outcome: item.lab_outcome,
      reviewer_minutes: itemMinutes,
      duration_s: video?.duration_s ?? null,
      reasons: [...new Set(reasons.map((r) => reasonLabel(r.code)))],
    });

    if (!video) {
      counts.missing_file++;
      continue;
    }
    if (!ormes || !d) {
      if (video.status === "failed") counts.failed++;
      else counts.pending++;
      continue;
    }
    counts.decided++;
    confusion[ormes][item.reviewer_decision]++;

    minutes.before += itemMinutes;
    if (ormes === "review") minutes.after += itemMinutes;
    const duration = videoDuration(video.duration_s, storedChecks);
    if (duration === null) minutes.footageKnown = false;
    else minutes.footageSeconds += duration;

    if (item.lab_outcome) {
      lab.videos++;
      const withOrmes = ormes === "review" ? item.reviewer_decision : ormes;
      if (item.lab_outcome === "reject") {
        lab.labRejects++;
        if (item.reviewer_decision === "accept") lab.reviewerFA++;
        if (withOrmes === "accept") lab.ormesFA++;
      } else {
        lab.labAccepts++;
        if (item.reviewer_decision === "reject") lab.reviewerFR++;
        if (withOrmes === "reject") lab.ormesFR++;
      }
    }

    for (const [name, result] of Object.entries(storedChecks)) {
      const status = result?.status;
      if (status !== "pass" && status !== "fail" && status !== "uncertain") continue;
      let row = checks.get(name);
      if (!row) checks.set(name, (row = { check: name, label: checkLabel(name), flagged_on_rejected: 0, rejected: 0, flagged_on_accepted: 0, accepted: 0 }));
      const flagged = status !== "pass";
      if (item.reviewer_decision === "reject") {
        row.rejected++;
        if (flagged) row.flagged_on_rejected++;
      } else {
        row.accepted++;
        if (flagged) row.flagged_on_accepted++;
      }
    }

    const originality = storedChecks.originality;
    const matched = originality?.measurements?.match_video_id;
    if ((originality?.status === "fail" || reasons.some((r) => r.code === "originality.duplicate")) && typeof matched === "string" && matched) {
      const own = item.contributor_ref ?? video.contributor_ref;
      const theirs = input.contributors?.get(matched) ?? null;
      const sim = originality?.measurements?.max_similarity;
      duplicates.push({
        external_id: item.external_id,
        video_id: video.id,
        contributor_ref: own,
        matched_video_id: matched,
        matched_contributor_ref: theirs,
        same_contributor: own && theirs ? own === theirs : null,
        similarity: typeof sim === "number" ? sim : null,
      });
    }

    if (ormes !== "review" && ormes !== item.reviewer_decision) {
      const duration = videoDuration(video.duration_s, storedChecks);
      disagreements.push({
        external_id: item.external_id,
        video_id: video.id,
        kind: ormes === "accept" ? "false_accept" : "false_reject",
        reviewer: item.reviewer_decision,
        ormes,
        reasons: [...new Set(reasons.map((r) => reasonLabel(r.code)))],
        moments: flaggedMoments(reasons, storedChecks, duration)
          .slice(0, 6)
          .map((m) => ({ t: m.t === null ? null : momentClock(m.t), label: m.label, detail: m.detail })),
      });
    }
  }

  const reviewerRejects = confusion.accept.reject + confusion.reject.reject + confusion.review.reject;
  const reviewerAccepts = confusion.accept.accept + confusion.reject.accept + confusion.review.accept;
  const ormesRejects = confusion.reject.accept + confusion.reject.reject;
  const auto = confusion.accept.accept + confusion.accept.reject + ormesRejects;
  const hours = minutes.footageSeconds / 3600;
  const perHour = (m: number) => (minutes.footageKnown && hours > 0 ? m / hours : null);

  const metrics: PilotReport["metrics"] = {
    review_minutes_change: minutes.before > 0 ? minutes.after / minutes.before - 1 : null,
    false_accept_rate: ratio(confusion.accept.reject, reviewerRejects),
    false_reject_rate: ratio(confusion.reject.accept, reviewerAccepts),
    rejection_precision: ratio(confusion.reject.reject, ormesRejects),
    rejection_recall: ratio(confusion.reject.reject + confusion.review.reject, reviewerRejects),
    automatic_rate: ratio(auto, counts.decided),
    reviewer_reject_rate: ratio(reviewerRejects, counts.decided),
    agreement: ratio(confusion.accept.accept + confusion.reject.reject, auto),
  };
  const labSummary = {
    videos: lab.videos,
    reviewer_false_accept_rate: ratio(lab.reviewerFA, lab.labRejects),
    reviewer_false_reject_rate: ratio(lab.reviewerFR, lab.labAccepts),
    with_ormes_false_accept_rate: ratio(lab.ormesFA, lab.labRejects),
    with_ormes_false_reject_rate: ratio(lab.ormesFR, lab.labAccepts),
  };

  const criteria = input.criteria.map((c): CriterionResult => {
    const description = describeCriterion(c);
    if (c.kind === "false_accepts_vs_lab_not_above_reviewers") {
      const actual = labSummary.with_ormes_false_accept_rate;
      const baseline = labSummary.reviewer_false_accept_rate;
      if (actual === null || baseline === null) {
        return { criterion: c, description, actual, baseline, verdict: "not_measurable", detail: "Needs lab outcomes that include rejections." };
      }
      return {
        criterion: c,
        description,
        actual,
        baseline,
        verdict: actual <= baseline + 1e-9 ? "pass" : "fail",
        detail: `With Ormes ${pct(actual)} vs your reviewers ${pct(baseline)} (${lab.labRejects} lab rejections)`,
      };
    }
    const actual = metrics[c.metric];
    if (actual === null) return { criterion: c, description, actual, baseline: null, verdict: "not_measurable", detail: "Not enough decided videos for this figure." };
    const ok = c.op === "<=" ? actual <= c.value + 1e-9 : actual >= c.value - 1e-9;
    const shown = METRICS[c.metric].unit === "change" ? signedPct(actual) : pct(actual);
    return { criterion: c, description, actual, baseline: null, verdict: ok ? "pass" : "fail", detail: `Measured ${shown}` };
  });

  const complete = counts.pending === 0;
  const verdict: PilotReport["verdict"] = !complete
    ? "provisional"
    : criteria.some((c) => c.verdict === "fail")
      ? "fail"
      : criteria.some((c) => c.verdict === "not_measurable")
        ? "not_measurable"
        : "pass";

  const rank = (c: string) => (CHECK_ORDER.includes(c) ? CHECK_ORDER.indexOf(c) : CHECK_ORDER.length);
  disagreements.sort((a, b) => (a.kind === b.kind ? a.external_id.localeCompare(b.external_id) : a.kind === "false_accept" ? -1 : 1));

  return {
    generated_at: new Date(input.now ?? Date.now()).toISOString(),
    status: complete ? "complete" : "running",
    verdict,
    counts,
    confusion,
    metrics,
    minutes: {
      before: minutes.before,
      after: minutes.after,
      saved: minutes.before - minutes.after,
      footage_hours: hours,
      per_hour_before: perHour(minutes.before),
      per_hour_after: perHour(minutes.after),
      assumed_minutes: assumed,
    },
    lab: labSummary,
    criteria,
    checks: [...checks.values()].sort((a, b) => rank(a.check) - rank(b.check) || a.check.localeCompare(b.check)),
    duplicates: {
      across_contributors: duplicates.filter((d) => d.same_contributor === false).length,
      same_contributor: duplicates.filter((d) => d.same_contributor === true).length,
      unknown: duplicates.filter((d) => d.same_contributor === null).length,
      items: duplicates,
    },
    disagreements,
    rows,
  };
}
