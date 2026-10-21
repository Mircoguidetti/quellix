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
    if (session.role === "reviewer") return { ok: false, error: "Only owners and admins can edit rubrics." };
    const input = rubricInputSchema.parse(raw);
    const body = rubricId
      ? await updateRubric(db, orgId, z.string().uuid().parse(rubricId), input, session.userId)
      : await createRubric(db, orgId, input, session.userId);
    return { ok: true, id: body.id, version: body.version };
  } catch (e) {
    if (e instanceof ApiError && e.status === 409) return { ok: false, error: "Someone saved this rubric a moment ago. Reload to see their version, then save again." };
    if (e instanceof ApiError && e.status === 400) return { ok: false, error: "The rubric does not match the schema. Check the Validation panel." };
    if (e instanceof ApiError && e.status === 404) return { ok: false, error: "This rubric no longer exists." };
    return { ok: false, error: "We could not save the rubric. Try again in a moment." };
  }
}
