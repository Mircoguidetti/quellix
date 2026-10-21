import { reasonLabel } from "@/lib/format";

export type TimelineReason = { check: string; code: string; message: string; effect: string };
export type StoredCheck = { status?: string; measurements?: Record<string, unknown> };

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** The video length: the row's duration, else the technical check's measurement. */
export function videoDuration(durationS: number | null | undefined, checks: Record<string, StoredCheck>): number | null {
  return num(durationS) ?? num(checks.technical?.measurements?.duration_s);
}

/** One thing a reviewer should look at: a reason, at a moment in the video when we know it. */
export type Moment = {
  key: string;
  /** Seconds from the start, or null for reasons about the whole video. */
  t: number | null;
  end?: number;
  label: string;
  message: string;
  effect: "reject" | "review";
  code: string;
  reasonIndex: number;
  /** The measurement behind the reason, at that moment. */
  detail: string;
};

const pct = (x: unknown) => (typeof x === "number" ? `${Math.round(x * 100)}%` : "—");
const clock = (t: number) => {
  const s = Math.max(0, Math.floor(t));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
};
const MAX_DETECTIONS = 12;

function wholeVideoDetail(r: TimelineReason, m: Record<string, unknown>): string {
  const [check, kind] = r.code.split(".");
  if (kind === "error" || kind === "missing_measurement") return "The check did not produce a measurement";
  if (check === "framing") return kind === "off_target" ? `Off target ${pct(m.off_target_ratio)} of frames` : `Unstable ${pct(m.unstable_ratio)} of frames`;
  if (check === "technical") {
    if (kind === "too_short" || kind === "too_long") return `Duration ${typeof m.duration_s === "number" ? clock(m.duration_s) : "—"}`;
    if (kind === "low_resolution") return `Resolution ${m.width ?? "?"}×${m.height ?? "?"}`;
    if (kind === "low_fps") return `${num(m.fps) ?? "?"} fps`;
    if (kind === "blurry") return `Blurry ${pct(m.blur_ratio)} of frames`;
    if (kind === "bad_exposure") return `Badly exposed ${pct(m.bad_exposure_ratio)} of frames`;
    if (kind === "not_decodable") return "The file could not be decoded";
  }
  if (check === "originality") {
    const sim = num(m.max_similarity);
    return `Similarity ${sim === null ? "—" : sim.toFixed(2)}${m.match_video_id ? ` with ${String(m.match_video_id)}` : ""}`;
  }
  return r.message;
}

/**
 * Every flagged moment of a decision, in time order, then reasons about the whole video. Privacy
 * reasons give one moment per detection; the task check points at where the model saw it end;
 * hands at the first manipulation segment. Each moment carries the measurement behind it.
 */
export function flaggedMoments(reasons: TimelineReason[], checks: Record<string, StoredCheck>, duration: number | null): Moment[] {
  const clamp = (t: number) => (duration === null ? Math.max(0, t) : Math.min(Math.max(0, t), duration));
  const timed: Moment[] = [];
  const whole: Moment[] = [];
  reasons.forEach((r, reasonIndex) => {
    const m = checks[r.check]?.measurements ?? {};
    const base = { label: reasonLabel(r.code), message: r.message, effect: (r.effect === "reject" ? "reject" : "review") as Moment["effect"], code: r.code, reasonIndex };
    if (r.check === "privacy" && !r.code.endsWith(".error")) {
      const kind = r.code.split(".")[1];
      const list = (Array.isArray(m[kind]) ? (m[kind] as { t_s?: unknown; box?: unknown }[]) : []).filter((d) => num(d?.t_s) !== null);
      list.slice(0, MAX_DETECTIONS).forEach((d, i) => {
        const box = Array.isArray(d.box) ? (d.box as number[]) : null;
        const size = box ? ` · ${Math.round(box[2] * 100)}%×${Math.round(box[3] * 100)}% of the frame` : "";
        timed.push({ ...base, key: `${reasonIndex}-${i}`, t: clamp(d.t_s as number), detail: `Detection ${i + 1} of ${list.length}${size}` });
      });
      if (list.length) return;
    } else if (r.check === "task_completed" && !r.code.endsWith(".error")) {
      const end = num(m.end_s);
      const start = num(m.start_s);
      const t = end ?? start;
      if (t !== null) {
        const span = start !== null && end !== null ? `task ${clock(start)}–${clock(end)}` : `task at ${clock(t)}`;
        timed.push({ ...base, key: `${reasonIndex}`, t: clamp(t), detail: `Completed ${m.completed === true ? "yes" : m.completed === false ? "no" : "unknown"} · confidence ${pct(m.confidence)} · ${span}` });
        return;
      }
    } else if (r.check === "hands_visible" && r.code === "hands_visible.below_min") {
      const segments = (Array.isArray(m.manipulation_segments) ? (m.manipulation_segments as unknown[]) : []).filter(
        (s): s is number[] => Array.isArray(s) && num(s[0]) !== null,
      );
      const ratio = Object.entries(m).find(([k]) => k.startsWith("ratio_") && r.message.includes(pct(m[k])))?.[1];
      if (segments.length) {
        timed.push({
          ...base,
          key: `${reasonIndex}`,
          t: clamp(segments[0][0]),
          end: num(segments[0][1]) ?? undefined,
          detail: `Visible ${pct(ratio)} while handling objects · ${segments.map((s) => `${clock(s[0])}–${clock(s[1])}`).join(", ")}`,
        });
        return;
      }
    }
    whole.push({ ...base, key: `${reasonIndex}`, t: null, detail: wholeVideoDetail(r, m) });
  });
  timed.sort((a, b) => (a.t ?? 0) - (b.t ?? 0));
  return [...timed, ...whole];
}
