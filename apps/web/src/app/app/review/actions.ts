"use server";

import { z } from "zod";
import { ApiError } from "@/lib/api/errors";
import { reviewSchema } from "@/lib/api/schemas";
import { dashboardContext } from "@/lib/dashboard";
import { insertReview, undoReview } from "@/lib/domain/videos";

export type ReviewResult = { ok: true; reviewId: string } | { ok: false; error: string };

export async function submitReview(videoId: string, raw: unknown): Promise<ReviewResult> {
  try {
    const { db, orgId, session } = await dashboardContext();
    const id = z.string().uuid().parse(videoId);
    const input = reviewSchema.parse(raw);
    const reviewId = await insertReview(db, orgId, id, { decision: input.decision, note: input.note?.trim() || undefined }, session.userId);
    return { ok: true, reviewId };
  } catch (e) {
    return { ok: false, error: e instanceof ApiError && e.status === 404 ? "This video no longer exists." : "We could not save the review. Try again." };
  }
}

export async function undoReviewAction(reviewId: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const { db, orgId, session } = await dashboardContext();
    await undoReview(db, orgId, z.string().uuid().parse(reviewId), session.userId);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof ApiError && e.status === 409 ? "Too late to undo: the review is already recorded." : "We could not undo the review." };
  }
}
