/** Helpers for the /media-preview page: which hand boxes to draw at a given video time. */

export type HandState = "full" | "truncated" | "absent";
export type HandRow = { state: HandState; box: [number, number, number, number] | null; contact: string };
export type FrameRow = { t: number; left: HandRow; right: HandRow };

export type ClipDecision = {
  decision: "accept" | "reject" | "review";
  reasons: { check: string; code: string; message: string; effect: string }[];
  checks?: Record<string, { status: string }>;
} | null;

export type ClipSidecar = {
  schema: string;
  id: string;
  source: { dataset: string; license: string; task: string; clip_id: string; group: string; segment_in_source_s: [number, number] };
  video: { mp4: string; webm: string; poster: string; width: number; height: number; fps: number; duration_s: number };
  hands: { model: string; sample_fps: number; frames: FrameRow[] };
  steps: ClipStep[];
  decision: ClipDecision;
  selection: { both_hands_full: number; both_hands_working: number; mean_luminance: number; contrast: number };
};

export type ClipStep = { name: string; t_s: number; end_s?: number; source?: string };

export type ClipManifest = {
  sources: { dataset: string; license: string }[];
  total_bytes: number;
  clips: {
    id: string;
    source_clip: string;
    factory: string;
    dataset: string;
    license: string;
    task: string;
    decision: string | null;
    mp4: string;
    webm: string;
    poster: string;
    bytes: Record<string, number>;
  }[];
};

/** The sampled frame closest to `t` (frames are sorted by time), or null when there are none. */
export function frameAt(frames: readonly FrameRow[], t: number): FrameRow | null {
  if (frames.length === 0) return null;
  let lo = 0;
  let hi = frames.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (frames[mid].t < t) lo = mid + 1;
    else hi = mid;
  }
  const after = frames[lo];
  const before = frames[Math.max(0, lo - 1)];
  return Math.abs(before.t - t) <= Math.abs(after.t - t) ? before : after;
}

/** A normalized box as pixel rectangle inside a width x height canvas, clamped to the canvas. */
export function boxRect(box: [number, number, number, number], width: number, height: number) {
  const clamp = (v: number) => Math.min(1, Math.max(0, v));
  const [x0, y0, x1, y1] = box.map(clamp);
  return { x: x0 * width, y: y0 * height, w: Math.max(0, x1 - x0) * width, h: Math.max(0, y1 - y0) * height };
}

export const STATE_COLOR: Record<HandState, string> = {
  full: "#3ddc97",
  truncated: "#f5a524",
  absent: "transparent",
};

export const STATE_LABEL: Record<HandState, string> = {
  full: "whole",
  truncated: "cut by the edge",
  absent: "not seen",
};

/** The step active at time `t`: the last one that started at or before it, and has not ended yet. */
export function stepAt(steps: readonly ClipStep[], t: number): ClipStep | null {
  let current: ClipStep | null = null;
  for (const s of steps) {
    if (s.t_s > t || (s.end_s !== undefined && s.end_s < t)) continue;
    if (!current || s.t_s >= current.t_s) current = s;
  }
  return current;
}

/** "HoloAssist (CDLA-Permissive-2.0)" for a list of sources, for the page intro. */
export function sourcesLabel(sources: readonly { dataset: string; license: string }[]): string {
  return sources.map((s) => `${s.dataset} (${s.license})`).join(" and ");
}
