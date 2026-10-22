/** A lab spec turned into a rubric draft, every value cited to a line of the source (issue #28). */

/** Rubric paths the importer may set: exactly the fields `rubric.schema.json` supports. */
export const FIELD_PATHS = [
  "task.description",
  "task.steps",
  "task.final_state",
  "checks.task_completed.enabled",
  "checks.hands_visible.enabled",
  "checks.hands_visible.scope",
  "checks.hands_visible.require_both",
  "checks.hands_visible.min_ratio",
  "checks.framing.enabled",
  "checks.framing.max_off_target_ratio",
  "checks.framing.max_unstable_ratio",
  "checks.technical.min_duration_s",
  "checks.technical.max_duration_s",
  "checks.technical.min_width",
  "checks.technical.min_height",
  "checks.technical.min_fps",
  "checks.technical.max_blur_ratio",
  "checks.technical.max_bad_exposure_ratio",
  "checks.privacy.faces",
  "checks.privacy.documents",
  "checks.privacy.screens",
  "checks.originality.on_duplicate",
] as const;
export type FieldPath = (typeof FIELD_PATHS)[number];

export type FieldValue = string | number | boolean | string[];

/** One rubric value and where it came from. `line` is 1-based in the normalized source. */
export type CitedField = { path: FieldPath; value: FieldValue; line: number; quote: string; source: "rules" | "model" };

/** A requirement the rubric cannot express yet (e.g. landscape orientation, idle time). */
export type Unsupported = { line: number; quote: string; note: string };

export type SpecDraft = {
  name: string;
  /** The rubric input (name, task, checks), built only from `fields`. */
  rubric: { name: string; task: Record<string, unknown>; checks: Record<string, Record<string, unknown>> };
  fields: CitedField[];
  unsupported: Unsupported[];
  /** What the importer could not use, e.g. model proposals that failed verification. */
  warnings: string[];
  usedModel: boolean;
};
