"use server";

import { z } from "zod";
import { dashboardContext } from "@/lib/dashboard";
import { rateLimited } from "@/lib/rate-limit";
import { draftFromSpec, externalModelsConfigured, orgAllowsExternalModels, type SpecDraft } from "@/lib/spec-import";

export type ImportResult = { ok: true; draft: SpecDraft } | { ok: false; error: string };

const inputSchema = z.object({
  text: z.string().trim().min(20, "Paste at least a few lines of the lab's guidelines.").max(200_000, "That document is too long; paste the relevant sections."),
  useModel: z.boolean(),
});

/**
 * Lab guidelines -> cited rubric draft. The text goes to an external model only when the caller
 * asked for it AND the organization allows external models AND the deployment does too; otherwise
 * only the local rules run and nothing leaves our servers.
 */
export async function importSpec(raw: unknown): Promise<ImportResult> {
  try {
    const { db, orgId, session } = await dashboardContext();
    if (session.role === "reviewer") return { ok: false, error: "Only owners and admins can create rubrics." };
    const parsed = inputSchema.safeParse(raw);
    if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
    const { text, useModel } = parsed.data;

    const configured = useModel ? externalModelsConfigured() : null;
    const allowed = configured !== null && (await orgAllowsExternalModels(db, orgId));
    if (allowed && configured) {
      if (rateLimited(`spec-import:${orgId}`, 30)) return { ok: false, error: "Too many imports in the last hour. Try again later, or turn off the external model." };
      return { ok: true, draft: await draftFromSpec(text, { useModel: true, apiKey: configured.key }) };
    }
    const draft = await draftFromSpec(text, { useModel: false });
    if (useModel) draft.warnings.unshift("The external model is not allowed for this organization or deployment, so only the local rules were used.");
    return { ok: true, draft };
  } catch {
    return { ok: false, error: "We could not read that spec. Try again in a moment." };
  }
}
