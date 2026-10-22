import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { errors } from "@/lib/api/errors";
import { checkLabel, reasonLabel } from "@/lib/format";
import { pilotsEnabled } from "@/lib/pilots/flag";

// Lab audit export (issue #25, part 2): what a lab asks a collector for in procurement, per rubric
// version over a batch of videos. A batch is a window of days (UTC) on the date a video was received.

const DAY = 86_400_000;
export const DEFAULT_WINDOW_DAYS = 30;
export const MAX_WINDOW_DAYS = 366;
/** Above this many videos in one window the export asks for a narrower one instead of timing out. */
export const MAX_AUDIT_VIDEOS = 20_000;
/** PostgREST returns at most this many rows per request (supabase/config.toml max_rows). */
const PAGE = 1000;
/** Video ids per `in (...)` filter: keeps request URLs well under common limits. */
const ID_CHUNK = 150;

const CHECK_ORDER = ["task_completed", "hands_visible", "framing", "technical", "privacy", "originality"];
const CHECK_STATUSES = ["pass", "fail", "uncertain", "skipped", "error"] as const;
type CheckStatus = (typeof CHECK_STATUSES)[number];

// ---------------------------------------------------------------- query

const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "must be a date like 2026-10-01").refine((s) => {
  const t = Date.parse(`${s}T00:00:00Z`);
  return Number.isFinite(t) && new Date(t).toISOString().startsWith(s);
}, "must be a real calendar date");

const first = (v: unknown) => (Array.isArray(v) ? v[0] : v);
const blankToUndefined = (v: unknown) => {
  const value = first(v);
  return value === "" || value === null ? undefined : value;
};

export const auditQuerySchema = z
  .object({
    from: z.preprocess(blankToUndefined, ymd.optional()),
    to: z.preprocess(blankToUndefined, ymd.optional()),
    rubric_id: z.preprocess(blankToUndefined, z.string().uuid().optional()),
    version: z.preprocess(blankToUndefined, z.coerce.number().int().min(1).optional()),
    format: z.preprocess(blankToUndefined, z.enum(["json", "csv"]).default("json")),
  })
  .refine((q) => q.version === undefined || q.rubric_id !== undefined, {
    message: "version needs rubric_id",
    path: ["version"],
  });

export type AuditQuery = z.infer<typeof auditQuerySchema>;
export type AuditWindow = { from: string; to: string };

/** The window in whole UTC days, `to` inclusive. Defaults to the last 30 days, today included. */
export function resolveWindow(q: Pick<AuditQuery, "from" | "to">, now = Date.now()): AuditWindow {
  const today = new Date(now).toISOString().slice(0, 10);
  const to = q.to ?? today;
  const from = q.from ?? new Date(Date.parse(`${to}T00:00:00Z`) - (DEFAULT_WINDOW_DAYS - 1) * DAY).toISOString().slice(0, 10);
  const days = (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY + 1;
  if (days < 1) throw errors.badRequest("from must be on or before to");
  if (days > MAX_WINDOW_DAYS) throw errors.badRequest(`The window can span at most ${MAX_WINDOW_DAYS} days`);
  return { from, to };
}

/** Parse URL search params (API or dashboard) into a validated query. Throws ZodError on bad input. */
export function parseAuditQuery(params: URLSearchParams | Record<string, string | string[] | undefined>): AuditQuery {
  const raw = params instanceof URLSearchParams ? Object.fromEntries(params.entries()) : params;
  return auditQuerySchema.parse(raw);
}

// ---------------------------------------------------------------- computation

export type AuditVideo = { id: string; external_id: string | null; rubric_id: string; rubric_version: number; created_at: string };
export type AuditDecision = { video_id: string; decision: string; reasons: unknown; checks: unknown; created_at: string };
export type AuditReview = { video_id: string; decision: string; note: string | null; created_at: string };
export type AuditRubric = { id: string; name: string };

export type CheckRow = Record<CheckStatus, number> & { check: string; label: string; evaluated: number; pass_rate: number | null };
export type CodeCount = { code: string; label: string; count: number };
export type Override = {
  video_id: string;
  external_id: string | null;
  automatic: "accept" | "reject";
  final: "accept" | "reject";
  note: string | null;
  reviewed_at: string;
};

export type AuditGroup = {
  rubric: { id: string; name: string; version: number };
  videos: { received: number; decided: number; not_decided: number; accept: number; reject: number; review: number };
  automatic_rate: number | null;
  checks: CheckRow[];
  rejection_codes: CodeCount[];
  review_codes: CodeCount[];
  human_review: {
    routed_to_review: number;
    routed_rate: number | null;
    review_resolved_accept: number;
    review_resolved_reject: number;
    review_pending: number;
    automatic_sampled: number;
    sampling_rate: number | null;
    reviewed_total: number;
    reviewed_rate: number | null;
  };
  overrides: { total: number; accept_to_reject: number; reject_to_accept: number; rate: number | null; items: Override[] };
};

export type AuditReport = {
  object: "audit_report";
  generated_at: string;
  window: AuditWindow;
  filters: { rubric_id: string | null; version: number | null };
  definitions: Record<string, string>;
  groups: AuditGroup[];
};

export const AUDIT_DEFINITIONS: Record<string, string> = {
  window: "Videos received between window.from and window.to (UTC days, both included).",
  decision: "Each video counts once, with its latest decision. Videos without a decision are counted in not_decided.",
  automatic_rate: "(accept + reject) / decided: share decided without a person.",
  pass_rate: "pass / (pass + fail + uncertain + error) for that check; skipped checks are left out.",
  rejection_codes: "Reason codes with effect reject on rejected videos; one count per video and code.",
  review_codes: "Reason codes with effect review on videos sent to review; one count per video and code.",
  routed_rate: "review / decided: share sent to a person by the rubric.",
  sampling_rate: "Automatic decisions (accept or reject) that a person also checked / automatic decisions.",
  reviewed_rate: "Videos with at least one human review / decided.",
  overrides: "Automatic decisions that a person changed (latest human review differs). Rate = overrides / automatic decisions checked by a person.",
};

const ratio = (n: number, d: number) => (d ? n / d : null);

function latestBy<T extends { video_id: string; created_at: string }>(rows: T[]): Map<string, T> {
  const out = new Map<string, T>();
  for (const r of rows) {
    const cur = out.get(r.video_id);
    if (!cur || r.created_at > cur.created_at) out.set(r.video_id, r);
  }
  return out;
}

function codesOf(reasons: unknown, effect: "reject" | "review"): Set<string> {
  const out = new Set<string>();
  if (!Array.isArray(reasons)) return out;
  for (const r of reasons as { code?: unknown; effect?: unknown }[]) {
    if (r && r.effect === effect && typeof r.code === "string" && r.code) out.add(r.code);
  }
  return out;
}

function sortedCodes(counts: Map<string, number>): CodeCount[] {
  return [...counts.entries()]
    .map(([code, count]) => ({ code, label: reasonLabel(code), count }))
    .sort((a, b) => b.count - a.count || a.code.localeCompare(b.code));
}

/** Pure: groups videos per rubric version and computes every audit figure. */
export function computeAudit(input: {
  videos: AuditVideo[];
  decisions: AuditDecision[];
  reviews: AuditReview[];
  rubrics: AuditRubric[];
  window: AuditWindow;
  filters?: { rubric_id?: string; version?: number };
  now?: number;
}): AuditReport {
  const decisions = latestBy(input.decisions);
  const reviews = latestBy(input.reviews);
  const reviewedVideos = new Set(input.reviews.map((r) => r.video_id));
  const names = new Map(input.rubrics.map((r) => [r.id, r.name]));

  type Acc = {
    group: AuditGroup;
    checks: Map<string, Record<CheckStatus, number>>;
    rejectCodes: Map<string, number>;
    reviewCodes: Map<string, number>;
  };
  const groups = new Map<string, Acc>();

  for (const v of input.videos) {
    const key = `${v.rubric_id}@${v.rubric_version}`;
    let acc = groups.get(key);
    if (!acc) {
      acc = {
        group: {
          rubric: { id: v.rubric_id, name: names.get(v.rubric_id) ?? "Deleted rubric", version: v.rubric_version },
          videos: { received: 0, decided: 0, not_decided: 0, accept: 0, reject: 0, review: 0 },
          automatic_rate: null,
          checks: [],
          rejection_codes: [],
          review_codes: [],
          human_review: {
            routed_to_review: 0,
            routed_rate: null,
            review_resolved_accept: 0,
            review_resolved_reject: 0,
            review_pending: 0,
            automatic_sampled: 0,
            sampling_rate: null,
            reviewed_total: 0,
            reviewed_rate: null,
          },
          overrides: { total: 0, accept_to_reject: 0, reject_to_accept: 0, rate: null, items: [] },
        },
        checks: new Map(),
        rejectCodes: new Map(),
        reviewCodes: new Map(),
      };
      groups.set(key, acc);
    }
    const g = acc.group;
    g.videos.received++;
    const d = decisions.get(v.id);
    if (!d || (d.decision !== "accept" && d.decision !== "reject" && d.decision !== "review")) {
      g.videos.not_decided++;
      continue;
    }
    g.videos.decided++;
    g.videos[d.decision]++;

    if (d.checks && typeof d.checks === "object") {
      for (const [name, result] of Object.entries(d.checks as Record<string, { status?: unknown }>)) {
        const status = result?.status;
        if (!CHECK_STATUSES.includes(status as CheckStatus)) continue;
        let row = acc.checks.get(name);
        if (!row) acc.checks.set(name, (row = { pass: 0, fail: 0, uncertain: 0, skipped: 0, error: 0 }));
        row[status as CheckStatus]++;
      }
    }

    const review = reviews.get(v.id);
    if (reviewedVideos.has(v.id)) g.human_review.reviewed_total++;

    if (d.decision === "reject") for (const c of codesOf(d.reasons, "reject")) acc.rejectCodes.set(c, (acc.rejectCodes.get(c) ?? 0) + 1);
    if (d.decision === "review") {
      for (const c of codesOf(d.reasons, "review")) acc.reviewCodes.set(c, (acc.reviewCodes.get(c) ?? 0) + 1);
      g.human_review.routed_to_review++;
      if (review?.decision === "accept") g.human_review.review_resolved_accept++;
      else if (review?.decision === "reject") g.human_review.review_resolved_reject++;
      else g.human_review.review_pending++;
      continue;
    }

    // Automatic decision (accept or reject). A person may have checked it anyway.
    if (!review || (review.decision !== "accept" && review.decision !== "reject")) continue;
    g.human_review.automatic_sampled++;
    if (review.decision !== d.decision) {
      g.overrides.total++;
      if (d.decision === "accept") g.overrides.accept_to_reject++;
      else g.overrides.reject_to_accept++;
      g.overrides.items.push({
        video_id: v.id,
        external_id: v.external_id,
        automatic: d.decision,
        final: review.decision,
        note: review.note,
        reviewed_at: review.created_at,
      });
    }
  }

  const out: AuditGroup[] = [];
  for (const { group: g, checks, rejectCodes, reviewCodes } of groups.values()) {
    const automatic = g.videos.accept + g.videos.reject;
    g.automatic_rate = ratio(automatic, g.videos.decided);
    g.human_review.routed_rate = ratio(g.videos.review, g.videos.decided);
    g.human_review.sampling_rate = ratio(g.human_review.automatic_sampled, automatic);
    g.human_review.reviewed_rate = ratio(g.human_review.reviewed_total, g.videos.decided);
    g.overrides.rate = ratio(g.overrides.total, g.human_review.automatic_sampled);
    g.overrides.items.sort((a, b) => b.reviewed_at.localeCompare(a.reviewed_at));
    g.checks = [...checks.entries()]
      .map(([check, counts]) => {
        const evaluated = counts.pass + counts.fail + counts.uncertain + counts.error;
        return { check, label: checkLabel(check), ...counts, evaluated, pass_rate: ratio(counts.pass, evaluated) };
      })
      .sort((a, b) => rank(a.check) - rank(b.check) || a.check.localeCompare(b.check));
    g.rejection_codes = sortedCodes(rejectCodes);
    g.review_codes = sortedCodes(reviewCodes);
    out.push(g);
  }
  out.sort((a, b) => a.rubric.name.localeCompare(b.rubric.name) || a.rubric.id.localeCompare(b.rubric.id) || b.rubric.version - a.rubric.version);

  return {
    object: "audit_report",
    generated_at: new Date(input.now ?? Date.now()).toISOString(),
    window: input.window,
    filters: { rubric_id: input.filters?.rubric_id ?? null, version: input.filters?.version ?? null },
    definitions: AUDIT_DEFINITIONS,
    groups: out,
  };
}

function rank(check: string): number {
  const i = CHECK_ORDER.indexOf(check);
  return i === -1 ? CHECK_ORDER.length : i;
}

// ---------------------------------------------------------------- CSV

export const CSV_COLUMNS = ["rubric_id", "rubric_name", "rubric_version", "section", "key", "metric", "value"] as const;

/** RFC 4180 quoting, and a leading apostrophe on text a spreadsheet would run as a formula. */
export function csvCell(value: string | number | null): string {
  if (value === null) return "";
  let s = String(value);
  if (typeof value === "string" && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
}

const num = (n: number | null) => (n === null ? null : Number.isInteger(n) ? n : Number(n.toFixed(4)));

/**
 * One long table: every figure is a row (section, key, metric, value), so it opens as-is in a
 * spreadsheet and pivots by rubric version. Overrides carry the reviewer's note as the value.
 */
export function auditToCsv(report: AuditReport): string {
  const lines: string[] = [CSV_COLUMNS.join(",")];
  for (const g of report.groups) {
    const row = (section: string, key: string, metric: string, value: string | number | null) =>
      lines.push([g.rubric.id, g.rubric.name, g.rubric.version, section, key, metric, value].map(csvCell).join(","));
    for (const [metric, value] of Object.entries(g.videos)) row("videos", "", metric, value);
    row("videos", "", "automatic_rate", num(g.automatic_rate));
    for (const c of g.checks) {
      for (const s of CHECK_STATUSES) row("check", c.check, s, c[s]);
      row("check", c.check, "pass_rate", num(c.pass_rate));
    }
    for (const c of g.rejection_codes) row("rejection_code", c.code, "count", c.count);
    for (const c of g.review_codes) row("review_code", c.code, "count", c.count);
    for (const [metric, value] of Object.entries(g.human_review)) row("human_review", "", metric, num(value));
    row("overrides", "", "total", g.overrides.total);
    row("overrides", "", "accept_to_reject", g.overrides.accept_to_reject);
    row("overrides", "", "reject_to_accept", g.overrides.reject_to_accept);
    row("overrides", "", "rate", num(g.overrides.rate));
    for (const o of g.overrides.items) row("override", o.external_id ?? o.video_id, `${o.automatic}_to_${o.final}`, o.note ?? "");
  }
  return `${lines.join("\r\n")}\r\n`;
}

export function auditFilename(report: AuditReport, ext: "csv" | "json"): string {
  return `audit_${report.window.from}_${report.window.to}.${ext}`;
}

/** The HTTP response for a report, shared by the API and the dashboard download. */
export function auditResponse(report: AuditReport, format: "json" | "csv", download: boolean): Response {
  const headers: Record<string, string> = { "cache-control": "no-store" };
  if (download) headers["content-disposition"] = `attachment; filename="${auditFilename(report, format)}"`;
  if (format === "csv") {
    return new Response(auditToCsv(report), { headers: { ...headers, "content-type": "text/csv; charset=utf-8" } });
  }
  return Response.json(report, { headers });
}

// ---------------------------------------------------------------- loading

export async function pageAll<T>(fetchPage: (from: number, to: number) => PromiseLike<{ data: unknown; error: unknown }>, cap: number): Promise<T[]> {
  const out: T[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await fetchPage(offset, offset + PAGE - 1);
    if (error) throw errors.internal();
    const rows = (data ?? []) as T[];
    out.push(...rows);
    if (rows.length < PAGE || out.length > cap) return out;
  }
}

export function chunks<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** Runs `fn` over the chunks a few at a time, so a large window does not open hundreds of requests at once. */
export async function mapLimited<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

/** Reads everything the report needs for one organization; every query is scoped by orgId. */
export async function loadAudit(db: SupabaseClient, orgId: string, q: AuditQuery, now = Date.now()): Promise<AuditReport> {
  const window = resolveWindow(q, now);
  const fromIso = `${window.from}T00:00:00.000Z`;
  const toIso = new Date(Date.parse(`${window.to}T00:00:00Z`) + DAY).toISOString();

  if (q.rubric_id) {
    const { data, error } = await db.from("rubrics").select("id").eq("org_id", orgId).eq("id", q.rubric_id).maybeSingle();
    if (error) throw errors.internal();
    if (!data) throw errors.notFound("Rubric not found");
  }

  const videos = await pageAll<AuditVideo>((a, b) => {
    let query = db
      .from("videos")
      .select("id, external_id, rubric_id, rubric_version, created_at")
      .eq("org_id", orgId)
      .gte("created_at", fromIso)
      .lt("created_at", toIso);
    if (q.rubric_id) query = query.eq("rubric_id", q.rubric_id);
    if (q.version) query = query.eq("rubric_version", q.version);
    // Shadow pilot videos are not production decisions (issue #65).
    if (pilotsEnabled()) query = query.eq("shadow", false);
    return query.order("created_at", { ascending: true }).order("id", { ascending: true }).range(a, b);
  }, MAX_AUDIT_VIDEOS);
  if (videos.length > MAX_AUDIT_VIDEOS) {
    throw errors.badRequest(`More than ${MAX_AUDIT_VIDEOS} videos in this window: choose a shorter window or one rubric`);
  }

  const ids = chunks(videos.map((v) => v.id), ID_CHUNK);
  const perChunk = (table: "decisions" | "reviews", columns: string) =>
    mapLimited(ids, 6, (chunk) =>
      pageAll<Record<string, unknown>>(
        (a, b) => db.from(table).select(columns).eq("org_id", orgId).in("video_id", chunk).order("id", { ascending: true }).range(a, b),
        Number.POSITIVE_INFINITY,
      ),
    ).then((parts) => parts.flat());

  const [decisions, reviews, rubrics] = await Promise.all([
    perChunk("decisions", "video_id, decision, reasons, checks, created_at"),
    perChunk("reviews", "video_id, decision, note, created_at"),
    db.from("rubrics").select("id, name").eq("org_id", orgId),
  ]);
  if (rubrics.error) throw errors.internal();

  return computeAudit({
    videos,
    decisions: decisions as AuditDecision[],
    reviews: reviews as AuditReview[],
    rubrics: (rubrics.data ?? []) as AuditRubric[],
    window,
    filters: { rubric_id: q.rubric_id, version: q.version },
    now,
  });
}
