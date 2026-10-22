import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { assemble } from "./assemble";
import { proposeWithGemini, verifyProposals } from "./model";
import { extractWithRules } from "./rules";
import { normalizeSource, toLines } from "./source";
import type { SpecDraft } from "./types";

export type { SpecDraft } from "./types";

/**
 * The deployment kill switch (same variable as the worker) and a key. Without both, no customer
 * text is ever sent out, whatever the organization setting says.
 */
export function externalModelsConfigured(): { key: string } | null {
  if (process.env.QUELLIX_ALLOW_EXTERNAL_MODELS !== "1") return null;
  const key = process.env.GEMINI_API_KEY;
  return key ? { key } : null;
}

export async function orgAllowsExternalModels(db: SupabaseClient, orgId: string): Promise<boolean> {
  const { data } = await db.from("organizations").select("allow_external_models").eq("id", orgId).maybeSingle();
  return data?.allow_external_models === true;
}

/**
 * Lab guidelines -> cited rubric draft. `useModel` must only be true when both the organization
 * and the deployment allow external models; the caller checks.
 */
export async function draftFromSpec(
  raw: string,
  opts: { useModel: false } | { useModel: true; apiKey: string; fetchImpl?: typeof fetch },
): Promise<SpecDraft> {
  const lines = toLines(normalizeSource(raw));
  const rules = extractWithRules(lines);
  if (!opts.useModel) return assemble(lines, rules.fields, rules.unsupported, [], false);
  try {
    const verified = verifyProposals(lines, await proposeWithGemini(lines, opts.apiKey, opts.fetchImpl));
    return assemble(lines, [...verified.fields, ...rules.fields], [...verified.unsupported, ...rules.unsupported], verified.warnings, true);
  } catch {
    return assemble(lines, rules.fields, rules.unsupported, ["The external model did not answer; this draft uses the local rules only."], false);
  }
}
