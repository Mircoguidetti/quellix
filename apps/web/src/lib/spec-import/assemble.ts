import { validateRubric } from "@/lib/rubric";
import type { CitedField, FieldPath, FieldValue, SpecDraft, Unsupported } from "./types";
import { FIELD_PATHS } from "./types";
import type { SourceLine } from "./source";

type Check = (v: unknown) => boolean;
const ratio: Check = (v) => typeof v === "number" && v >= 0 && v <= 1;
// Upper bounds are sanity limits for imported values (the schema has none): a spec never asks
// for 1,000 fps or a 24-hour clip, so such a value is a misreading.
const between = (min: number, max: number): Check => (v) => typeof v === "number" && Number.isFinite(v) && v >= min && v <= max;
const int = (min: number, max: number): Check => (v) => Number.isInteger(v) && (v as number) >= min && (v as number) <= max;
const oneOf = (...xs: string[]): Check => (v) => typeof v === "string" && xs.includes(v);
const bool: Check = (v) => typeof v === "boolean";
const text = (max: number): Check => (v) => typeof v === "string" && v.trim().length > 0 && v.length <= max;

/** Type and range of every importable path, mirroring rubric.schema.json. */
export const VALUE_CHECKS: Record<FieldPath, Check> = {
  "task.description": text(2000),
  "task.steps": (v) => Array.isArray(v) && v.length > 0 && v.length <= 50 && v.every((s) => text(300)(s)),
  "task.final_state": text(500),
  "checks.task_completed.enabled": bool,
  "checks.hands_visible.enabled": bool,
  "checks.hands_visible.scope": oneOf("manipulation", "whole_video"),
  "checks.hands_visible.require_both": bool,
  "checks.hands_visible.min_ratio": ratio,
  "checks.framing.enabled": bool,
  "checks.framing.max_off_target_ratio": ratio,
  "checks.framing.max_unstable_ratio": ratio,
  "checks.technical.min_duration_s": between(0, 86_400),
  "checks.technical.max_duration_s": between(0, 86_400),
  "checks.technical.min_width": int(1, 16_384),
  "checks.technical.min_height": int(1, 16_384),
  "checks.technical.min_fps": between(1, 1_000),
  "checks.technical.max_blur_ratio": ratio,
  "checks.technical.max_bad_exposure_ratio": ratio,
  "checks.privacy.faces": oneOf("reject", "review", "ignore"),
  "checks.privacy.documents": oneOf("reject", "review", "ignore"),
  "checks.privacy.screens": oneOf("reject", "review", "ignore"),
  "checks.originality.on_duplicate": oneOf("reject", "review"),
};

export const isFieldPath = (p: unknown): p is FieldPath => typeof p === "string" && (FIELD_PATHS as readonly string[]).includes(p);

const same = (a: FieldValue, b: FieldValue) => JSON.stringify(a) === JSON.stringify(b);

/**
 * One value per path. Earlier fields win (callers pass verified model fields before rule fields);
 * a disagreement is reported so the collector can pick.
 */
export function resolveFields(fields: CitedField[]): { fields: CitedField[]; warnings: string[] } {
  const byPath = new Map<FieldPath, CitedField>();
  const warnings: string[] = [];
  for (const f of fields) {
    const kept = byPath.get(f.path);
    if (!kept) byPath.set(f.path, f);
    else if (!same(kept.value, f.value))
      warnings.push(`${f.path}: line ${kept.line} gives ${JSON.stringify(kept.value)}, line ${f.line} gives ${JSON.stringify(f.value)}. Kept line ${kept.line}; check the spec.`);
  }
  return { fields: FIELD_PATHS.flatMap((p) => (byPath.has(p) ? [byPath.get(p)!] : [])), warnings };
}

function titleOf(lines: SourceLine[]): SourceLine | undefined {
  return lines.find((l) => l.text.length >= 3 && l.text.length <= 100);
}

/** Builds the rubric input from cited fields only; the task description falls back to the title line. */
export function assemble(lines: SourceLine[], cited: CitedField[], unsupported: Unsupported[], warnings: string[], usedModel: boolean): SpecDraft {
  const resolved = resolveFields(cited);
  const fields = [...resolved.fields];
  const title = titleOf(lines);
  if (!fields.some((f) => f.path === "task.description") && title) {
    fields.unshift({ path: "task.description", value: title.text.replace(/[:.]\s*$/, ""), line: title.n, quote: title.text, source: "rules" });
  }
  const task: Record<string, unknown> = {};
  const checks: Record<string, Record<string, unknown>> = {};
  for (const f of fields) {
    const [root, a, b] = f.path.split(".");
    if (root === "task") task[a] = f.value;
    else (checks[a] ??= {})[b] = f.value;
  }
  const name = (title?.text ?? "Imported spec").replace(/[:.]\s*$/, "").slice(0, 120);
  const rubric = { name, task, checks };
  const problems = validateRubric({ id: "draft", version: 1, ...rubric });
  return {
    name,
    rubric,
    fields,
    unsupported: dedupeUnsupported(unsupported),
    warnings: [...warnings, ...resolved.warnings, ...problems.map((p) => `The draft does not match the rubric schema yet: ${p}`)],
    usedModel,
  };
}

function dedupeUnsupported(items: Unsupported[]): Unsupported[] {
  const seen = new Set<string>();
  return items
    .filter((u) => {
      const key = `${u.line}|${u.note}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => a.line - b.line);
}
