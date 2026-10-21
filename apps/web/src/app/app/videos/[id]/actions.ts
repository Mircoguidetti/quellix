"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { labOutcomeSchema, reviewSchema } from "@/lib/api/schemas";
import { dashboardContext } from "@/lib/dashboard";
import { insertReview, setLabOutcome } from "@/lib/domain/videos";

type Result = { ok: true } | { ok: false; error: string };

export async function saveLabOutcome(videoId: string, raw: unknown): Promise<Result> {
  try {
    const { db, orgId } = await dashboardContext();
    const id = z.string().uuid().parse(videoId);
    const input = labOutcomeSchema.parse(raw);
    await setLabOutcome(db, orgId, id, { outcome: input.outcome, reason: input.reason?.trim() || undefined });
    revalidatePath(`/app/videos/${id}`);
    return { ok: true };
  } catch {
    return { ok: false, error: "We could not save the lab outcome. Try again." };
  }
}

/** A person overrides the automatic decision (or decides a video sent to review). */
export async function overrideDecision(videoId: string, raw: unknown): Promise<Result> {
  try {
    const { db, orgId, session } = await dashboardContext();
    const id = z.string().uuid().parse(videoId);
    const input = reviewSchema.parse(raw);
    await insertReview(db, orgId, id, { decision: input.decision, note: input.note?.trim() || undefined }, session.userId);
    revalidatePath(`/app/videos/${id}`);
    return { ok: true };
  } catch {
    return { ok: false, error: "We could not save your decision. Try again." };
  }
}
