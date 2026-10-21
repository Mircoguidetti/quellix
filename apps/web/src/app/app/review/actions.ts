"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { dashboardContext } from "@/lib/dashboard";
import { reviewSchema } from "@/lib/api/schemas";
import { reviewVideo } from "@/lib/domain/videos";

export async function submitReview(formData: FormData) {
  const { db, orgId, session } = await dashboardContext();
  const videoId = z.string().uuid().parse(formData.get("video_id"));
  const note = String(formData.get("note") ?? "").trim();
  const input = reviewSchema.parse({ decision: formData.get("decision"), note: note || undefined });
  await reviewVideo(db, orgId, videoId, input, session.userId);
  revalidatePath("/app/review");
}
