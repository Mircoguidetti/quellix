"use server";

import { z } from "zod";
import { ApiError } from "@/lib/api/errors";
import { rubricInputSchema } from "@/lib/api/schemas";
import { dashboardContext } from "@/lib/dashboard";
import { createRubric, updateRubric } from "@/lib/domain/rubrics";

export type SaveRubricResult = { ok: true; id: string; version: number } | { ok: false; error: string };

export async function saveRubric(rubricId: string | null, raw: unknown): Promise<SaveRubricResult> {
  try {
    const { db, orgId, session } = await dashboardContext();
    if (session.role === "reviewer") return { ok: false, error: "Only owners and admins can edit rubrics" };
    const input = rubricInputSchema.parse(raw);
    const body = rubricId
      ? await updateRubric(db, orgId, z.string().uuid().parse(rubricId), input, session.userId)
      : await createRubric(db, orgId, input, session.userId);
    return { ok: true, id: body.id, version: body.version };
  } catch (e) {
    return { ok: false, error: e instanceof ApiError || e instanceof Error ? e.message : "Could not save" };
  }
}
