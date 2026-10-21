import { z } from "zod";
import { DEFAULTS } from "./rubric-eval";

/** The rubric editor's form model: every field explicit, schema defaults filled in. */
const ratio = z.number().min(0).max(1);
const optionalNumber = (min: number, message: string) =>
  z.number({ error: "Enter a number." }).min(min, message).optional();
const handling = z.enum(["reject", "review", "ignore"]);

export const rubricFormSchema = z
  .object({
    name: z.string().trim().min(1, "Give the rubric a name.").max(200),
    task: z.object({
      description: z.string().trim().min(1, "Describe the task, as the lab does."),
      library_id: z.string().trim().max(100).regex(/^[a-z0-9_]*$/, "Lowercase letters, digits and underscores only."),
      steps: z.string().max(4000),
      final_state: z.string().trim().max(500),
    }),
    checks: z.object({
      task_completed: z.object({ enabled: z.boolean(), critical: z.boolean(), min_confidence: ratio }),
      hands_visible: z.object({
        enabled: z.boolean(),
        critical: z.boolean(),
        scope: z.enum(["manipulation", "whole_video"]),
        require_both: z.boolean(),
        min_ratio: ratio,
      }),
      framing: z.object({ enabled: z.boolean(), critical: z.boolean(), max_off_target_ratio: ratio, max_unstable_ratio: ratio }),
      technical: z.object({
        enabled: z.boolean(),
        critical: z.boolean(),
        min_duration_s: optionalNumber(0, "Cannot be negative."),
        max_duration_s: optionalNumber(0, "Cannot be negative."),
        min_width: optionalNumber(1, "At least 1 px.").refine((v) => v === undefined || Number.isInteger(v), "Whole pixels only."),
        min_height: optionalNumber(1, "At least 1 px.").refine((v) => v === undefined || Number.isInteger(v), "Whole pixels only."),
        min_fps: optionalNumber(1, "At least 1 fps."),
        max_blur_ratio: ratio,
        max_bad_exposure_ratio: ratio,
      }),
      privacy: z.object({ enabled: z.boolean(), faces: handling, documents: handling, screens: handling }),
      originality: z.object({ enabled: z.boolean(), similarity_threshold: ratio, on_duplicate: z.enum(["reject", "review"]) }),
    }),
  })
  .superRefine((v, ctx) => {
    const t = v.checks.technical;
    if (t.min_duration_s !== undefined && t.max_duration_s !== undefined && t.max_duration_s < t.min_duration_s) {
      ctx.addIssue({ code: "custom", path: ["checks", "technical", "max_duration_s"], message: "Must be at least the minimum duration." });
    }
  });

export type RubricFormValues = z.infer<typeof rubricFormSchema>;
type Json = Record<string, unknown>;

const OPTIONAL_TECH = ["min_duration_s", "max_duration_s", "min_width", "min_height", "min_fps"] as const;

/** A stored rubric body (or the contract example) as form values. */
export function toFormValues(body: { name: string; task: Json; checks: Json }): RubricFormValues {
  const check = <K extends keyof typeof DEFAULTS>(k: K) => ({ ...DEFAULTS[k], ...((body.checks[k] as Json | undefined) ?? {}) }) as Json;
  const technical = check("technical");
  for (const k of OPTIONAL_TECH) if (typeof technical[k] !== "number") delete technical[k];
  return {
    name: body.name,
    task: {
      description: String(body.task.description ?? ""),
      library_id: String(body.task.library_id ?? ""),
      steps: Array.isArray(body.task.steps) ? (body.task.steps as string[]).join("\n") : "",
      final_state: String(body.task.final_state ?? ""),
    },
    checks: {
      task_completed: check("task_completed"),
      hands_visible: check("hands_visible"),
      framing: check("framing"),
      technical,
      privacy: check("privacy"),
      originality: check("originality"),
    } as RubricFormValues["checks"],
  };
}

/** Form values as the `{name, task, checks}` the save action and rubric.schema.json expect. */
export function toRubricInput(v: RubricFormValues): { name: string; task: Json; checks: Json } {
  const steps = v.task.steps.split("\n").map((s) => s.trim()).filter(Boolean);
  const task: Json = { description: v.task.description.trim() };
  if (v.task.library_id.trim()) task.library_id = v.task.library_id.trim();
  if (steps.length) task.steps = steps;
  if (v.task.final_state.trim()) task.final_state = v.task.final_state.trim();
  const technical: Json = { ...v.checks.technical };
  for (const k of OPTIONAL_TECH) if (technical[k] === undefined || Number.isNaN(technical[k])) delete technical[k];
  return { name: v.name.trim(), task, checks: { ...v.checks, technical } };
}

const pct = (x: number) => `${Math.round(x * 100)}%`;

export type RuleSummary = { rejects: string[]; reviews: string[]; off: string[] };

/** Plain-language summary of what the rubric does, for the live preview. */
export function summarizeRules(v: RubricFormValues): RuleSummary {
  const out: RuleSummary = { rejects: [], reviews: [], off: [] };
  const c = v.checks;
  const put = (critical: boolean, text: string) => (critical ? out.rejects : out.reviews).push(text);
  if (c.task_completed.enabled) {
    put(c.task_completed.critical, "the task is not completed");
    out.reviews.push(`the model is less than ${pct(c.task_completed.min_confidence)} sure the task was completed`);
  } else out.off.push("Task completed");
  if (c.hands_visible.enabled) {
    const hands = c.hands_visible.require_both ? "both hands are" : "a hand is";
    const when = c.hands_visible.scope === "manipulation" ? "during manipulation" : "over the whole video";
    put(c.hands_visible.critical, `${hands} visible less than ${pct(c.hands_visible.min_ratio)} of the time ${when}`);
  } else out.off.push("Hands visible");
  if (c.framing.enabled) {
    put(c.framing.critical, `the camera points away from the work more than ${pct(c.framing.max_off_target_ratio)} of the time`);
    put(c.framing.critical, `the camera is unstable more than ${pct(c.framing.max_unstable_ratio)} of the time`);
  } else out.off.push("Framing and stability");
  if (c.technical.enabled) {
    const t = c.technical;
    out.rejects.push("the file cannot be decoded");
    if (t.min_duration_s !== undefined) put(t.critical, `it is shorter than ${t.min_duration_s} s`);
    if (t.max_duration_s !== undefined) put(t.critical, `it is longer than ${t.max_duration_s} s`);
    if (t.min_width !== undefined || t.min_height !== undefined) put(t.critical, `the resolution is below ${t.min_width ?? 0}×${t.min_height ?? 0}`);
    if (t.min_fps !== undefined) put(t.critical, `the frame rate is below ${t.min_fps} fps`);
    put(t.critical, `more than ${pct(t.max_blur_ratio)} of frames are blurry`);
    put(t.critical, `more than ${pct(t.max_bad_exposure_ratio)} of frames are too dark or too bright`);
  } else out.off.push("Technical quality");
  if (c.privacy.enabled) {
    for (const [kind, label] of [["faces", "a face"], ["documents", "a readable document"], ["screens", "a readable screen"]] as const) {
      const action = c.privacy[kind];
      if (action === "reject") out.rejects.push(`${label} is visible`);
      else if (action === "review") out.reviews.push(`${label} is visible`);
    }
  } else out.off.push("Privacy");
  if (c.originality.enabled) {
    const text = `it matches an earlier video with similarity ${c.originality.similarity_threshold.toFixed(2)} or more`;
    (c.originality.on_duplicate === "reject" ? out.rejects : out.reviews).push(text);
  } else out.off.push("Originality");
  out.reviews.push("any check fails to run");
  return out;
}
