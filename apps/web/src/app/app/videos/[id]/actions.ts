"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { dashboardContext } from "@/lib/dashboard";
import { labOutcomeSchema } from "@/lib/api/schemas";
import { setLabOutcome } from "@/lib/domain/videos";

export async function saveLabOutcome(formData: FormData) {
  const { db, orgId } = await dashboardContext();
  const videoId = z.string().uuid().parse(formData.get("video_id"));
  const reason = String(formData.get("reason") ?? "").trim();
  const input = labOutcomeSchema.parse({ outcome: formData.get("outcome"), reason: reason || undefined });
  await setLabOutcome(db, orgId, videoId, input);
  revalidatePath(`/app/videos/${videoId}`);
}
