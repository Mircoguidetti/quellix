// Display helpers shared by server and client components. Dates render in UTC so the server
// and the browser produce the same text (no hydration mismatch).

const STATUS_LABELS: Record<string, string> = {
  awaiting_upload: "Waiting for file",
  queued: "Queued",
  processing: "Analysing",
  decided: "Decided",
  failed: "Failed",
  deleted: "File deleted",
};

export function explainStatus(status: string): string {
  return STATUS_LABELS[status] ?? status;
}

export const VIDEO_STATUSES = Object.keys(STATUS_LABELS);

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${hh}:${mm} UTC`;
}

export function formatDay(iso: string): string {
  const d = new Date(iso);
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

/** "4 min", "3 h", "2 d" from a timestamp to `now`. */
export function formatAge(iso: string, now = Date.now()): string {
  const minutes = Math.max(0, Math.round((now - Date.parse(iso)) / 60000));
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} h`;
  return `${Math.round(hours / 24)} d`;
}

export function formatClock(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

export function formatHours(hours: number): string {
  if (hours < 1) return `${Math.round(hours * 60)} min`;
  return `${hours < 10 ? hours.toFixed(1) : Math.round(hours)} h`;
}

export function formatPercent(ratio: number | null): string {
  return ratio === null ? "—" : `${Math.round(ratio * 100)}%`;
}

export const CHECK_LABELS: Record<string, string> = {
  task_completed: "Task completed",
  hands_visible: "Hands visible",
  framing: "Framing and stability",
  technical: "Technical quality",
  privacy: "Privacy",
  originality: "Originality",
};

export function checkLabel(name: string): string {
  return CHECK_LABELS[name] ?? name.replaceAll("_", " ");
}

export function initials(name: string | undefined, email: string | undefined): string {
  const source = (name || email || "?").trim();
  const parts = source.split(/[\s@._-]+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "?") + (name && parts[1] ? parts[1][0] : "")).toUpperCase();
}

const REASON_LABELS: Record<string, string> = {
  "hands_visible.below_min": "Hands out of frame",
  "hands_visible.missing_measurement": "Hands not measured",
  "task_completed.not_completed": "Task not completed",
  "task_completed.uncertain": "Task unclear",
  "originality.duplicate": "Already delivered",
  "technical.not_decodable": "Unreadable file",
  "technical.too_short": "Too short",
  "technical.too_long": "Too long",
  "technical.low_resolution": "Low resolution",
  "technical.low_fps": "Low frame rate",
  "technical.blurry": "Blurry",
  "technical.bad_exposure": "Too dark or bright",
  "framing.off_target": "Camera off target",
  "framing.unstable": "Unstable camera",
  "privacy.faces": "Face visible",
  "privacy.documents": "Document visible",
  "privacy.screens": "Screen visible",
  "pipeline.skipped_without_reject": "Checks skipped",
};

/** Short label for a reason code; falls back to the check name for `<check>.error`. */
export function reasonLabel(code: string): string {
  if (REASON_LABELS[code]) return REASON_LABELS[code];
  const [check, kind] = code.split(".");
  return kind === "error" ? `${checkLabel(check)} failed` : code;
}
