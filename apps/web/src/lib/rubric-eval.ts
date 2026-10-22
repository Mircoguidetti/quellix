/**
 * Rubric evaluation, ported from services/worker/src/ormes_worker/rubric.py.
 *
 * The worker is the source of truth for real decisions. The dashboard uses this copy only to
 * preview what an edited rubric would do to measurements we already have (rubric editor) and to
 * fill the local demo data. Keep it in step with rubric.py; rubric-eval.test.ts mirrors its tests.
 */

export const CHECK_NAMES = ["task_completed", "hands_visible", "framing", "technical", "privacy", "originality"] as const;
export type CheckName = (typeof CHECK_NAMES)[number];
export type CheckStatus = "pass" | "fail" | "uncertain" | "skipped" | "error";
export type Effect = "reject" | "review";
export type DecisionValue = "accept" | "reject" | "review";

export type Reason = { check: CheckName; code: string; message: string; effect: Effect };
export type CheckResult = { status: CheckStatus; measurements: Record<string, unknown>; model?: string };
export type Measurements = Record<string, unknown>;
/** What a check produced: measurements, or an error, or a deliberate skip. */
export type CheckOutput = { measurements?: Measurements; error?: string; skipped?: string; model?: string };

type Cfg = Record<string, unknown>;

/** Defaults mirror packages/contracts/rubric.schema.json. */
export const DEFAULTS: Record<CheckName, Cfg> = {
  task_completed: { enabled: true, critical: true, min_confidence: 0.7 },
  hands_visible: { enabled: true, critical: true, scope: "manipulation", require_both: true, min_ratio: 0.8 },
  framing: { enabled: true, critical: false, max_off_target_ratio: 0.1, max_unstable_ratio: 0.1 },
  technical: { enabled: true, critical: true, max_blur_ratio: 0.05, max_bad_exposure_ratio: 0.1 },
  privacy: { enabled: true, faces: "review", documents: "review", screens: "review" },
  originality: { enabled: true, similarity_threshold: 0.9, on_duplicate: "reject" },
};

export function checkConfig(rubric: { checks?: Record<string, unknown> }, name: CheckName): Cfg {
  return { ...DEFAULTS[name], ...((rubric.checks?.[name] as Cfg | undefined) ?? {}) };
}

const num = (v: unknown, fallback = 0) => (typeof v === "number" && Number.isFinite(v) ? v : fallback);
// Python's round() rounds half to even; match it so messages are identical.
const pyRound = (x: number) => {
  const r = Math.round(x);
  return Math.abs(x % 1) === 0.5 && r % 2 !== 0 ? r - 1 : r;
};
const pct = (x: number) => `${pyRound(x * 100)}%`;
export const fmtSeconds = (t: number) => {
  const total = pyRound(t);
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
};

type Evaluator = (cfg: Cfg, m: Measurements) => [CheckStatus, Reason[]];

const taskCompleted: Evaluator = (cfg, m) => {
  const completed = m.completed;
  const confidence = num(m.confidence);
  const effect: Effect = cfg.critical ? "reject" : "review";
  if (completed === null || completed === undefined || confidence < num(cfg.min_confidence)) {
    return [
      "uncertain",
      [{ check: "task_completed", code: "task_completed.uncertain", message: "Could not tell with enough confidence whether the task was completed.", effect: "review" }],
    ];
  }
  if (!completed) {
    return ["fail", [{ check: "task_completed", code: "task_completed.not_completed", message: "The task does not appear to be completed.", effect }]];
  }
  return ["pass", []];
};

const handsVisible: Evaluator = (cfg, m) => {
  const scope = cfg.scope === "manipulation" ? "manipulation" : "whole";
  const which = cfg.require_both ? "both" : "any";
  const key = `ratio_${which}_${scope}`;
  if (!(key in m)) {
    return [
      "error",
      [{ check: "hands_visible", code: "hands_visible.missing_measurement", message: `Hand visibility could not be measured (${key}).`, effect: "review" }],
    ];
  }
  const ratio = num(m[key]);
  const min = num(cfg.min_ratio);
  if (ratio < min) {
    const hands = cfg.require_both ? "Both hands" : "Hands";
    const where = scope === "manipulation" ? "during manipulation" : "in the video";
    const effect: Effect = cfg.critical ? "reject" : "review";
    return [
      "fail",
      [{ check: "hands_visible", code: "hands_visible.below_min", message: `${hands} visible ${pct(ratio)} of the time ${where} (minimum ${pct(min)}).`, effect }],
    ];
  }
  return ["pass", []];
};

const framing: Evaluator = (cfg, m) => {
  const reasons: Reason[] = [];
  const effect: Effect = cfg.critical ? "reject" : "review";
  const off = num(m.off_target_ratio);
  const unstable = num(m.unstable_ratio);
  if (off > num(cfg.max_off_target_ratio)) {
    reasons.push({ check: "framing", code: "framing.off_target", message: `Camera pointed away from the work ${pct(off)} of the time (maximum ${pct(num(cfg.max_off_target_ratio))}).`, effect });
  }
  if (unstable > num(cfg.max_unstable_ratio)) {
    reasons.push({ check: "framing", code: "framing.unstable", message: `Unstable camera ${pct(unstable)} of the time (maximum ${pct(num(cfg.max_unstable_ratio))}).`, effect });
  }
  return [reasons.length ? "fail" : "pass", reasons];
};

const technical: Evaluator = (cfg, m) => {
  const effect: Effect = cfg.critical ? "reject" : "review";
  if (m.decodable === false) {
    return ["fail", [{ check: "technical", code: "technical.not_decodable", message: "The file could not be decoded.", effect: "reject" }]];
  }
  const reasons: Reason[] = [];
  const add = (code: string, message: string) => reasons.push({ check: "technical", code, message, effect });
  const duration = typeof m.duration_s === "number" ? m.duration_s : null;
  if (duration !== null) {
    if (typeof cfg.min_duration_s === "number" && duration < cfg.min_duration_s) {
      add("technical.too_short", `Video is ${duration.toFixed(0)}s long (minimum ${cfg.min_duration_s.toFixed(0)}s).`);
    }
    if (typeof cfg.max_duration_s === "number" && duration > cfg.max_duration_s) {
      add("technical.too_long", `Video is ${duration.toFixed(0)}s long (maximum ${cfg.max_duration_s.toFixed(0)}s).`);
    }
  }
  const width = typeof m.width === "number" ? m.width : null;
  const height = typeof m.height === "number" ? m.height : null;
  if (width !== null && height !== null && (width < num(cfg.min_width) || height < num(cfg.min_height))) {
    add("technical.low_resolution", `Resolution ${width}x${height} is below ${num(cfg.min_width)}x${num(cfg.min_height)}.`);
  }
  const fps = typeof m.fps === "number" ? m.fps : null;
  if (fps !== null && fps < num(cfg.min_fps)) {
    add("technical.low_fps", `${fps.toFixed(0)} fps is below the minimum of ${num(cfg.min_fps).toFixed(0)}.`);
  }
  const blur = typeof m.blur_ratio === "number" ? m.blur_ratio : null;
  if (blur !== null && blur > num(cfg.max_blur_ratio)) {
    add("technical.blurry", `Blurry ${pct(blur)} of the time (maximum ${pct(num(cfg.max_blur_ratio))}).`);
  }
  const exposure = typeof m.bad_exposure_ratio === "number" ? m.bad_exposure_ratio : null;
  if (exposure !== null && exposure > num(cfg.max_bad_exposure_ratio)) {
    add("technical.bad_exposure", `Too dark or too bright ${pct(exposure)} of the time (maximum ${pct(num(cfg.max_bad_exposure_ratio))}).`);
  }
  return [reasons.length ? "fail" : "pass", reasons];
};

const PRIVACY_LABELS = { faces: "face", documents: "readable document", screens: "readable screen" } as const;

const privacy: Evaluator = (cfg, m) => {
  const reasons: Reason[] = [];
  for (const [kind, label] of Object.entries(PRIVACY_LABELS)) {
    const action = cfg[kind];
    const found = Array.isArray(m[kind]) ? (m[kind] as unknown[]) : [];
    if (action === "ignore" || !found.length) continue;
    const head = found[0];
    const first = head && typeof head === "object" ? (head as { t_s?: unknown }).t_s : undefined;
    const at = typeof first === "number" ? ` at ${fmtSeconds(first)}` : "";
    const more = found.length > 1 ? ` (+${found.length - 1} more)` : "";
    reasons.push({ check: "privacy", code: `privacy.${kind}`, message: `A ${label} is visible${at}${more}.`, effect: action as Effect });
  }
  return [reasons.length ? "fail" : "pass", reasons];
};

const originality: Evaluator = (cfg, m) => {
  const similarity = num(m.max_similarity);
  if (similarity >= num(cfg.similarity_threshold)) {
    const match = m.match_video_id;
    const ref = match ? ` (matches video ${String(match)})` : "";
    return [
      "fail",
      [{ check: "originality", code: "originality.duplicate", message: `This video was already delivered${ref}; similarity ${similarity.toFixed(2)}.`, effect: cfg.on_duplicate as Effect }],
    ];
  }
  return ["pass", []];
};

const EVALUATORS: Record<CheckName, Evaluator> = {
  task_completed: taskCompleted,
  hands_visible: handsVisible,
  framing,
  technical,
  privacy,
  originality,
};

export type Evaluation = { decision: DecisionValue; reasons: Reason[]; checks: Record<string, CheckResult> };

/** Apply the rubric to the check outputs. Same decision rule as the worker. */
export function evaluate(rubric: { checks?: Record<string, unknown> }, outputs: Partial<Record<CheckName, CheckOutput>>): Evaluation {
  const checks: Record<string, CheckResult> = {};
  const reasons: Reason[] = [];
  for (const name of CHECK_NAMES) {
    const cfg = checkConfig(rubric, name);
    if (cfg.enabled === false) {
      checks[name] = { status: "skipped", measurements: {} };
      continue;
    }
    const out = outputs[name];
    if (out?.skipped !== undefined) {
      checks[name] = { status: "skipped", measurements: { reason: out.skipped }, ...(out.model ? { model: out.model } : {}) };
      continue;
    }
    if (!out || out.error !== undefined || out.measurements === undefined) {
      const detail = out?.error ? out.error : "check did not run";
      checks[name] = { status: "error", measurements: {}, ...(out?.model ? { model: out.model } : {}) };
      reasons.push({ check: name, code: `${name}.error`, message: `The ${name.replaceAll("_", " ")} check failed: ${detail}.`, effect: "review" });
      continue;
    }
    const [status, found] = EVALUATORS[name](cfg, out.measurements);
    checks[name] = { status, measurements: out.measurements, ...(out.model ? { model: out.model } : {}) };
    reasons.push(...found);
  }

  const skippedAny = Object.values(outputs).some((o) => o?.skipped !== undefined);
  let decision: DecisionValue;
  if (reasons.some((r) => r.effect === "reject")) decision = "reject";
  else if (skippedAny) {
    decision = "review";
    reasons.push({ check: "technical", code: "pipeline.skipped_without_reject", message: "Some checks were skipped without a rejection; a person should look at this video.", effect: "review" });
  } else if (reasons.length) decision = "review";
  else decision = "accept";

  // Reject reasons first: they are the ones a contributor needs to read. (Stable, like Python's sort.)
  const ordered = [...reasons.filter((r) => r.effect === "reject"), ...reasons.filter((r) => r.effect !== "reject")];
  return { decision, reasons: ordered, checks };
}

/** Rebuild check outputs from a stored decision's `checks` so a different rubric can be re-applied. */
export function outputsFromStoredChecks(checks: Record<string, { status?: string; measurements?: Measurements; model?: string }>) {
  const outputs: Partial<Record<CheckName, CheckOutput>> = {};
  for (const name of CHECK_NAMES) {
    const c = checks[name];
    if (!c) continue;
    if (c.status === "error") outputs[name] = { error: "stored result was an error", model: c.model };
    else if (c.status === "skipped") {
      const reason = c.measurements?.reason;
      // A check disabled by the old rubric has no measurements: we cannot know what it would say.
      if (typeof reason === "string") outputs[name] = { skipped: reason, model: c.model };
    } else outputs[name] = { measurements: c.measurements ?? {}, model: c.model };
  }
  return outputs;
}
