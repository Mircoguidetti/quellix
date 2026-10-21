import { reasonLabel } from "@/lib/format";

export type TimelineReason = { check: string; code: string; message: string; effect: string };
export type StoredCheck = { status?: string; measurements?: Record<string, unknown> };

export type Marker = {
  /** Seconds from the start of the video. */
  t: number;
  /** Optional end, for spans such as the task window. */
  end?: number;
  label: string;
  message: string;
  effect: "reject" | "review";
  code: string;
  /** Index into the decision's reasons, so the list and the timeline highlight together. */
  reasonIndex: number;
};

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

function firstDetection(list: unknown): number | null {
  if (!Array.isArray(list)) return null;
  for (const d of list) {
    const t = num((d as { t_s?: unknown } | null)?.t_s);
    if (t !== null) return t;
  }
  return null;
}

/**
 * Where on the timeline each reason belongs, from the measurements the worker recorded
 * (services/worker/CLAUDE.md): privacy detections carry `t_s`, the task check `start_s`/`end_s`,
 * hands `manipulation_segments`. Reasons without a moment in time get no marker.
 */
export function reasonMarkers(reasons: TimelineReason[], checks: Record<string, StoredCheck>, duration: number | null): Marker[] {
  const markers: Marker[] = [];
  reasons.forEach((r, reasonIndex) => {
    const m = checks[r.check]?.measurements ?? {};
    let t: number | null = null;
    let end: number | undefined;
    if (r.check === "privacy") {
      const kind = r.code.split(".")[1];
      t = firstDetection(m[kind]);
    } else if (r.check === "task_completed") {
      // The task ended early, or it is unclear: point at where the model saw it end.
      t = num(m.end_s) ?? num(m.start_s);
    } else if (r.check === "hands_visible") {
      const segments = Array.isArray(m.manipulation_segments) ? (m.manipulation_segments as unknown[]) : [];
      const first = segments.find((s) => Array.isArray(s) && num(s[0]) !== null) as number[] | undefined;
      if (first) {
        t = first[0];
        end = num(first[1]) ?? undefined;
      }
    }
    if (t === null) return;
    if (duration !== null) t = Math.min(Math.max(0, t), duration);
    markers.push({
      t,
      end,
      label: reasonLabel(r.code),
      message: r.message,
      effect: r.effect === "reject" ? "reject" : "review",
      code: r.code,
      reasonIndex,
    });
  });
  return markers.sort((a, b) => a.t - b.t);
}

/** The video length: the row's duration, else the technical check's measurement. */
export function videoDuration(durationS: number | null | undefined, checks: Record<string, StoredCheck>): number | null {
  return num(durationS) ?? num(checks.technical?.measurements?.duration_s);
}
