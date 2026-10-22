"use server";

import { ZodError } from "zod";
import { ApiError } from "@/lib/api/errors";
import { adminContext } from "@/lib/dashboard";
import { createPilot, createPilotSchema, finishPilotUpload, pilotUploadSchema, queueUrlItems, startPilotUpload } from "@/lib/domain/pilots";

type Fail = { ok: false; error: string };

function failure(e: unknown, fallback: string): Fail {
  if (e instanceof ZodError) return { ok: false, error: e.issues[0]?.message ?? fallback };
  if (e instanceof ApiError && e.status < 500) return { ok: false, error: `${e.message}.` };
  if (e instanceof Error && e.message.startsWith("Only owners and admins")) return { ok: false, error: e.message };
  return { ok: false, error: fallback };
}

/** Stores the pilot, its success criteria and the reviewers' decisions. Nothing runs yet. */
export async function createPilotAction(raw: unknown): Promise<{ ok: true; id: string } | Fail> {
  try {
    const { db, orgId, session } = await adminContext();
    const id = await createPilot(db, orgId, session.userId, createPilotSchema.parse(raw));
    return { ok: true, id };
  } catch (e) {
    return failure(e, "We could not create the pilot. Try again.");
  }
}

export async function startPilotUploadAction(pilotId: string, raw: unknown): Promise<{ ok: true; videoId: string; uploadUrl: string } | Fail> {
  try {
    const { db, orgId } = await adminContext();
    return { ok: true, ...(await startPilotUpload(db, orgId, pilotId, pilotUploadSchema.parse(raw))) };
  } catch (e) {
    return failure(e, "We could not start the upload. Try again.");
  }
}

export async function finishPilotUploadAction(pilotId: string, videoId: string): Promise<{ ok: true } | Fail> {
  try {
    const { db, orgId } = await adminContext();
    await finishPilotUpload(db, orgId, pilotId, videoId);
    return { ok: true };
  } catch (e) {
    return failure(e, "We could not queue the analysis. Try again.");
  }
}

/** Queues the rows that point at the collector's own signed URLs (the worker fetches them). */
export async function queueUrlItemsAction(pilotId: string): Promise<{ ok: true; queued: number } | Fail> {
  try {
    const { db, orgId } = await adminContext();
    return { ok: true, queued: await queueUrlItems(db, orgId, pilotId) };
  } catch (e) {
    return failure(e, "We could not queue the videos from their URLs. Try again.");
  }
}
