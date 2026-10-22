/**
 * Contributor feedback: what to fix and where, for the person who filmed the video (issue #22).
 *
 * Mirrors `contributorFeedback` in `@ormes/sdk` and `contributor_feedback` in the Python SDK; all
 * three are tested against `packages/contracts/examples/decision.feedback*.json`.
 * - keep only reasons the contributor may see (`contributor_visible`; absent means visible, except
 *   `originality.*` (never visible, whatever the flag says), `*.error` and `pipeline.*`);
 * - order by the start of the first segment, reasons about the whole video last;
 * - hidden reasons that reject collapse into one generic item, so a contributor never learns why a
 *   duplicate was caught; hidden review-only reasons are dropped.
 */

import { fmtSeconds } from "@/lib/rubric-eval";

export const GENERIC_HIDDEN_MESSAGE =
  "This video could not be accepted for a reason we cannot share. Ask the company that paid you for details.";

export type FeedbackSegment = { start_s: number; end_s: number };

export type FeedbackItem = {
  /** `null` for the generic item that stands for hidden rejections. */
  check: string | null;
  code: string | null;
  effect: "reject" | "review";
  message: string;
  hint: string | null;
  segments: FeedbackSegment[];
};

type ReasonLike = {
  check?: unknown;
  code?: unknown;
  message?: unknown;
  effect?: unknown;
  hint?: unknown;
  segments?: unknown;
  contributor_visible?: unknown;
};

export function isContributorVisible(reason: ReasonLike): boolean {
  const check = String(reason.check ?? "");
  const code = String(reason.code ?? "");
  if (check === "originality" || code.startsWith("originality.")) return false;
  if (typeof reason.contributor_visible === "boolean") return reason.contributor_visible;
  return !(code.endsWith(".error") || code.startsWith("pipeline."));
}

export function reasonSegments(value: unknown): FeedbackSegment[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(
      (s): s is FeedbackSegment =>
        typeof s?.start_s === "number" && Number.isFinite(s.start_s) && typeof s?.end_s === "number" && Number.isFinite(s.end_s),
    )
    .map((s) => ({ start_s: s.start_s, end_s: s.end_s }));
}

/** Feedback from a decision's `reasons` (any JSON; malformed entries are skipped). */
export function contributorFeedback(reasons: unknown): FeedbackItem[] {
  const list: ReasonLike[] = Array.isArray(reasons) ? (reasons as ReasonLike[]) : [];
  const shown: { start: number; index: number; item: FeedbackItem }[] = [];
  let hiddenReject = false;
  list.forEach((r, index) => {
    if (!r || typeof r !== "object") return;
    if (!isContributorVisible(r)) {
      hiddenReject ||= r.effect === "reject";
      return;
    }
    if (typeof r.message !== "string" || !r.message) return;
    const segments = reasonSegments(r.segments);
    shown.push({
      start: segments.length ? Math.min(...segments.map((s) => s.start_s)) : Number.POSITIVE_INFINITY,
      index,
      item: {
        check: typeof r.check === "string" ? r.check : null,
        code: typeof r.code === "string" ? r.code : null,
        effect: r.effect === "reject" ? "reject" : "review",
        message: r.message,
        hint: typeof r.hint === "string" && r.hint ? r.hint : null,
        segments,
      },
    });
  });
  shown.sort((a, b) => (a.start === b.start ? a.index - b.index : a.start < b.start ? -1 : 1));
  const out = shown.map((s) => s.item);
  if (hiddenReject) out.push({ check: null, code: null, effect: "reject", message: GENERIC_HIDDEN_MESSAGE, hint: null, segments: [] });
  return out;
}

/**
 * What the public contest page shows: the feedback for the reasons that caused the rejection
 * (`effect: reject`, issue #8). Review-only reasons are operational details for the collector.
 */
export function contestFeedback(reasons: unknown): FeedbackItem[] {
  return contributorFeedback(reasons).filter((i) => i.effect === "reject");
}

// Same rounding as the worker's reason messages ("visible at 00:29").
const clock = (t: number) => fmtSeconds(Math.max(0, t));

/** "00:12–00:18, 00:40–00:44" (a single instant reads "00:05"). */
export function formatSegments(segments: FeedbackSegment[]): string {
  return segments.map((s) => (clock(s.start_s) === clock(s.end_s) ? clock(s.start_s) : `${clock(s.start_s)}–${clock(s.end_s)}`)).join(", ");
}
