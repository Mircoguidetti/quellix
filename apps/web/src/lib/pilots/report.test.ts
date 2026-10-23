import { describe, expect, it } from "vitest";
import { pilotToCsv, pilotToPdf } from "./export";
import { computePilotReport, criteriaSchema, describeCriterion, type Criterion, type PilotDecisionIn, type PilotItemIn, type PilotVideoIn } from "./report";

type Case = { id: string; reviewer: "accept" | "reject"; ormes?: "accept" | "reject" | "review"; lab?: "accept" | "reject"; minutes?: number; status?: string; duration?: number; noVideo?: boolean; checks?: Record<string, unknown>; reasons?: unknown[] };

function build(cases: Case[]) {
  const items: PilotItemIn[] = cases.map((c) => ({
    external_id: c.id,
    reviewer_decision: c.reviewer,
    reviewer_minutes: c.minutes ?? null,
    lab_outcome: c.lab ?? null,
    contributor_ref: `c_${c.id}`,
    video_id: c.noVideo ? null : `vid-${c.id}`,
  }));
  const videos: PilotVideoIn[] = cases.filter((c) => !c.noVideo).map((c) => ({ id: `vid-${c.id}`, status: c.status ?? (c.ormes ? "decided" : "processing"), duration_s: c.duration ?? 600, contributor_ref: `c_${c.id}` }));
  const decisions: PilotDecisionIn[] = cases
    .filter((c) => c.ormes)
    .map((c) => ({ video_id: `vid-${c.id}`, decision: c.ormes!, reasons: c.reasons ?? [], checks: c.checks ?? {}, created_at: "2026-10-22T10:00:00Z" }));
  return { items, videos, decisions };
}

const handsFail = {
  checks: { hands_visible: { status: "fail", measurements: { manipulation_segments: [[12, 20]], ratio_both_manipulation: 0.4 } }, technical: { status: "pass" } },
  reasons: [{ check: "hands_visible", code: "hands_visible.below_min", message: "Both hands visible 40% (min 70%)", effect: "reject" }],
};

// 10 videos of 10 minutes; reviewers spend 3 minutes each.
const CASES: Case[] = (
  [
  { id: "a1", reviewer: "accept", ormes: "accept", lab: "accept", checks: { technical: { status: "pass" }, hands_visible: { status: "pass" } } },
  { id: "a2", reviewer: "accept", ormes: "accept", lab: "accept" },
  { id: "a3", reviewer: "accept", ormes: "accept", lab: "reject" }, // reviewers and Ormes both missed it
  { id: "a4", reviewer: "accept", ormes: "reject", lab: "accept", ...handsFail }, // false reject
  { id: "a5", reviewer: "accept", ormes: "review" },
  { id: "r1", reviewer: "reject", ormes: "reject", lab: "reject", ...handsFail },
  { id: "r2", reviewer: "reject", ormes: "reject" },
  { id: "r3", reviewer: "reject", ormes: "accept", lab: "reject" }, // false accept
  { id: "r4", reviewer: "reject", ormes: "review", lab: "reject" },
  { id: "p1", reviewer: "accept" }, // still processing
  { id: "f1", reviewer: "reject", status: "failed" },
  { id: "m1", reviewer: "accept", noVideo: true },
  ] satisfies Case[]
).map((c): Case => ({ minutes: 3, ...c }));

const criteria: Criterion[] = [
  { kind: "threshold", metric: "review_minutes_change", op: "<=", value: -0.4 },
  { kind: "false_accepts_vs_lab_not_above_reviewers" },
  { kind: "threshold", metric: "false_reject_rate", op: "<=", value: 0.1 },
];

describe("computePilotReport", () => {
  const report = computePilotReport({ ...build(CASES), criteria, now: Date.parse("2026-10-22T12:00:00Z") });

  it("counts every row once, by state", () => {
    expect(report.counts).toEqual({ videos: 12, decided: 9, pending: 1, failed: 1, missing_file: 1 });
    expect(report.status).toBe("running");
    expect(report.verdict).toBe("provisional");
  });

  it("crosses Ormes with the reviewers", () => {
    expect(report.confusion).toEqual({ accept: { accept: 3, reject: 1 }, reject: { accept: 1, reject: 2 }, review: { accept: 1, reject: 1 } });
    expect(report.metrics.false_accept_rate).toBeCloseTo(1 / 4);
    expect(report.metrics.false_reject_rate).toBeCloseTo(1 / 5);
    expect(report.metrics.rejection_precision).toBeCloseTo(2 / 3);
    expect(report.metrics.rejection_recall).toBeCloseTo(3 / 4);
    expect(report.metrics.automatic_rate).toBeCloseTo(7 / 9);
    expect(report.metrics.agreement).toBeCloseTo(5 / 7);
    expect(report.metrics.reviewer_reject_rate).toBeCloseTo(4 / 9);
  });

  it("estimates review minutes: people only review what Ormes sends to review", () => {
    expect(report.minutes).toMatchObject({ before: 27, after: 6, saved: 21, assumed_minutes: 3 });
    expect(report.minutes.footage_hours).toBeCloseTo(1.5);
    expect(report.minutes.per_hour_before).toBeCloseTo(18);
    expect(report.minutes.per_hour_after).toBeCloseTo(4);
    expect(report.metrics.review_minutes_change).toBeCloseTo(6 / 27 - 1);
  });

  it("compares with the lab, using the reviewers' decision for review cases", () => {
    // Lab rejects: a3 (reviewer accept, Ormes accept), r1, r3 (Ormes accept), r4 (review → reviewer reject).
    expect(report.lab).toEqual({
      videos: 7,
      reviewer_false_accept_rate: 1 / 4,
      reviewer_false_reject_rate: 0,
      with_ormes_false_accept_rate: 2 / 4,
      with_ormes_false_reject_rate: 1 / 3,
    });
  });

  it("evaluates each pre-agreed criterion", () => {
    expect(report.criteria.map((c) => c.verdict)).toEqual(["pass", "fail", "fail"]);
    expect(report.criteria[1].detail).toBe("With Ormes 50% vs your reviewers 25% (4 lab rejections)");
    expect(report.criteria[0].description).toBe("Review minutes per video-hour: at most −40%");
  });

  it("lists disagreements, false accepts first, with the moments to inspect", () => {
    expect(report.disagreements.map((d) => [d.external_id, d.kind])).toEqual([
      ["r3", "false_accept"],
      ["a4", "false_reject"],
    ]);
    expect(report.disagreements[1].moments[0]).toMatchObject({ t: "00:12", label: "Hands out of frame" });
  });

  it("measures per-check flags on rejected and accepted videos", () => {
    const hands = report.checks.find((c) => c.check === "hands_visible")!;
    expect(hands).toMatchObject({ flagged_on_rejected: 1, rejected: 1, flagged_on_accepted: 1, accepted: 2 });
    expect(report.checks.map((c) => c.check)).toEqual(["hands_visible", "technical"]);
  });

  it("gives the final verdict once every video is done", () => {
    const done = computePilotReport({ ...build(CASES.filter((c) => c.id !== "p1")), criteria });
    expect(done.status).toBe("complete");
    expect(done.verdict).toBe("fail");
    const lenient = computePilotReport({ ...build(CASES.filter((c) => c.id !== "p1")), criteria: [criteria[0]] });
    expect(lenient.verdict).toBe("pass");
    const noLab = computePilotReport({ ...build(CASES.filter((c) => c.id !== "p1").map((c) => ({ ...c, lab: undefined }))), criteria: [criteria[1]] });
    expect(noLab.verdict).toBe("not_measurable");
  });

  it("finds duplicates across contributors", () => {
    const dup = computePilotReport({
      ...build([
        { id: "d1", reviewer: "reject", ormes: "reject", checks: { originality: { status: "fail", measurements: { match_video_id: "old-1", max_similarity: 0.97 } } }, reasons: [{ check: "originality", code: "originality.duplicate", message: "dup", effect: "reject" }] },
        { id: "d2", reviewer: "reject", ormes: "reject", checks: { originality: { status: "fail", measurements: { match_video_id: "old-2" } } } },
        { id: "d3", reviewer: "reject", ormes: "reject", checks: { originality: { status: "fail", measurements: { match_video_id: "old-3" } } } },
      ]),
      contributors: new Map([
        ["old-1", "c_other"],
        ["old-2", "c_d2"],
      ]),
      criteria,
    });
    expect(dup.duplicates).toMatchObject({ across_contributors: 1, same_contributor: 1, unknown: 1 });
    expect(dup.duplicates.items[0]).toMatchObject({ external_id: "d1", matched_contributor_ref: "c_other", same_contributor: false, similarity: 0.97 });
  });

  it("uses the pilot's default minutes, else the CSV average", () => {
    const cases = [
      { id: "x", reviewer: "accept" as const, ormes: "review" as const, minutes: 4 },
      { id: "y", reviewer: "accept" as const, ormes: "accept" as const },
    ];
    expect(computePilotReport({ ...build(cases), criteria }).minutes).toMatchObject({ assumed_minutes: 4, before: 8, after: 4 });
    expect(computePilotReport({ ...build(cases), criteria, defaultMinutes: 1 }).minutes).toMatchObject({ assumed_minutes: 1, before: 5 });
  });
});

describe("criteria", () => {
  it("validates criteria", () => {
    expect(criteriaSchema.safeParse([]).success).toBe(false);
    expect(criteriaSchema.safeParse([{ kind: "threshold", metric: "nope", op: "<=", value: 0.1 }]).success).toBe(false);
    expect(criteriaSchema.safeParse([{ kind: "threshold", metric: "automatic_rate", op: ">=", value: 2 }]).success).toBe(false);
    expect(criteriaSchema.parse([{ kind: "threshold", metric: "automatic_rate", op: ">=", value: 0.6 }])).toHaveLength(1);
    expect(describeCriterion({ kind: "threshold", metric: "automatic_rate", op: ">=", value: 0.6 })).toBe("Decided without a person: at least 60%");
  });
});

describe("exports", () => {
  const report = computePilotReport({ ...build(CASES), criteria, now: Date.parse("2026-10-22T12:00:00Z") });

  it("writes one CSV row per video with the outcome and the moments", () => {
    const lines = pilotToCsv(report).trimEnd().split("\r\n");
    expect(lines[0]).toBe("external_id,reviewer_decision,ormes_decision,outcome,lab_outcome,reviewer_minutes,duration_s,reasons,moments_to_inspect");
    expect(lines).toHaveLength(13);
    expect(lines.find((l) => l.startsWith("a4,"))).toBe("a4,accept,reject,false_reject,accept,3,600,Hands out of frame,00:12 Hands out of frame");
    expect(lines.find((l) => l.startsWith("m1,"))).toBe("m1,accept,,missing_file,,3,,,");
    expect(lines.find((l) => l.startsWith("a5,"))).toContain(",sent_to_review,");
  });

  it("renders a PDF", async () => {
    const pdf = await pilotToPdf({ id: "p", name: "October batch — “shadow”", rubric_name: "Load the dishwasher", rubric_version: 3, created_at: "2026-10-20T10:00:00Z" }, report);
    expect(Buffer.from(pdf.slice(0, 5)).toString()).toBe("%PDF-");
    expect(pdf.length).toBeGreaterThan(1500);
  });
});
