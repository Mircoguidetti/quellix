import type { Decision } from "./types";

/**
 * Contributor feedback: what to fix and where, ready to show the person who filmed the video.
 *
 * Same rule as the Python SDK and the web app (test vectors in
 * `packages/contracts/examples/decision.feedback*.json`):
 * - keep only reasons the contributor may see (`contributor_visible`; absent means visible, except
 *   `originality.*` (never visible, whatever the flag says), `*.error` and `pipeline.*`);
 * - order by the start of the first segment, reasons about the whole video last;
 * - hidden reasons that reject collapse into one generic item, so a contributor never learns why a
 *   duplicate was caught; hidden review-only reasons are dropped.
 */

export const GENERIC_HIDDEN_MESSAGE =
  "This video could not be accepted for a reason we cannot share. Ask the company that paid you for details.";

export interface FeedbackSegment {
  start_s: number;
  end_s: number;
}

export interface FeedbackItem {
  /** `null` for the generic item that stands for hidden rejections. */
  check: string | null;
  code: string | null;
  effect: "reject" | "review";
  message: string;
  hint: string | null;
  segments: FeedbackSegment[];
}

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

function segmentsOf(value: unknown): FeedbackSegment[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((s): s is { start_s: number; end_s: number } => typeof s?.start_s === "number" && typeof s?.end_s === "number")
    .map((s) => ({ start_s: s.start_s, end_s: s.end_s }));
}

/** Feedback for a decision (as returned by the API, or any object with `reasons`). */
export function contributorFeedback(decision: Pick<Decision, "reasons"> | { reasons?: unknown } | null | undefined): FeedbackItem[] {
  const reasons: ReasonLike[] = Array.isArray(decision?.reasons) ? (decision.reasons as ReasonLike[]) : [];
  const shown: { start: number; index: number; item: FeedbackItem }[] = [];
  let hiddenReject = false;
  reasons.forEach((r, index) => {
    if (!r) return;
    if (!isContributorVisible(r)) {
      hiddenReject ||= r.effect === "reject";
      return;
    }
    const segments = segmentsOf(r.segments);
    const start = segments.length ? Math.min(...segments.map((s) => s.start_s)) : Number.POSITIVE_INFINITY;
    shown.push({
      start,
      index,
      item: {
        check: typeof r.check === "string" ? r.check : null,
        code: typeof r.code === "string" ? r.code : null,
        effect: r.effect === "reject" ? "reject" : "review",
        message: typeof r.message === "string" ? r.message : "",
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
