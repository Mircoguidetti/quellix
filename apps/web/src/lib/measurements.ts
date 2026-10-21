import { formatClock } from "./format";

const LABELS: Record<string, string> = {
  completed: "Completed",
  confidence: "Confidence",
  start_s: "Task starts",
  end_s: "Task ends",
  steps: "Steps seen",
  ratio_both_manipulation: "Both hands, during manipulation",
  ratio_any_manipulation: "Any hand, during manipulation",
  ratio_both_whole: "Both hands, whole video",
  ratio_any_whole: "Any hand, whole video",
  manipulation_segments: "Manipulation",
  off_target_ratio: "Camera off target",
  unstable_ratio: "Unstable camera",
  decodable: "File readable",
  duration_s: "Duration",
  width: "Width",
  height: "Height",
  fps: "Frame rate",
  blur_ratio: "Blurry frames",
  bad_exposure_ratio: "Badly exposed frames",
  faces: "Faces",
  documents: "Documents",
  screens: "Screens",
  max_similarity: "Closest earlier video",
  match_video_id: "Matching video",
  reason: "Reason",
};

export function measurementLabel(key: string): string {
  return LABELS[key] ?? key.replaceAll("_", " ");
}

const pct = (x: number) => `${Math.round(x * 100)}%`;

/** A measurement as a short, readable value. Unknown shapes fall back to compact JSON. */
export function formatMeasurement(key: string, value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "boolean") return value ? "yes" : "no";
  if (typeof value === "number") {
    if (key.includes("ratio") || key === "confidence") return pct(value);
    if (key === "max_similarity") return value.toFixed(2);
    if (key.endsWith("_s")) return key === "duration_s" ? `${formatClock(value)} (${Math.round(value)} s)` : formatClock(value);
    if (key === "fps") return `${Math.round(value)} fps`;
    if (key === "width" || key === "height") return `${value} px`;
    return String(value);
  }
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    if (key === "manipulation_segments") {
      const spans = value.filter((s) => Array.isArray(s)).map((s) => `${formatClock(Number(s[0]))}–${formatClock(Number(s[1]))}`);
      return spans.length ? spans.join(", ") : "none";
    }
    if (key === "steps") return value.length ? value.map((s) => (s as { name?: string }).name ?? "step").join(" → ") : "none";
    if (!value.length) return "none";
    const times = value
      .map((d) => (d as { t_s?: unknown })?.t_s)
      .filter((t): t is number => typeof t === "number")
      .map(formatClock);
    const n = value.length;
    return times.length ? `${n} at ${times.slice(0, 3).join(", ")}${times.length > 3 ? "…" : ""}` : String(n);
  }
  return JSON.stringify(value);
}
