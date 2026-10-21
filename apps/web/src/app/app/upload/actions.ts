"use server";

import { dashboardContext } from "@/lib/dashboard";
import { ApiError } from "@/lib/api/errors";
import { createVideoSchema } from "@/lib/api/schemas";
import { completeUpload, createVideo } from "@/lib/domain/videos";

export type StartResult =
  | { ok: true; videoId: string; uploadUrl: string }
  | { ok: false; error: string };

/** Registers the video and returns a signed URL; the browser uploads the bytes straight to Storage. */
export async function startUpload(raw: unknown): Promise<StartResult> {
  try {
    const { db, orgId } = await dashboardContext();
    const input = createVideoSchema.parse(raw);
    const res = await createVideo(db, orgId, input);
    return { ok: true, videoId: res.video.id, uploadUrl: res.upload_url };
  } catch (e) {
    return { ok: false, error: e instanceof ApiError && e.status < 500 ? `${e.message}.` : "We could not start the upload. Try again." };
  }
}

export async function finishUpload(videoId: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const { db, orgId } = await dashboardContext();
    await completeUpload(db, orgId, videoId);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof ApiError && e.status < 500 ? `${e.message}.` : "We could not queue the analysis. Try again." };
  }
}
