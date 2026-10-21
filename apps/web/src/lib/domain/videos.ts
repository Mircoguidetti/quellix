import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { errors } from "@/lib/api/errors";
import type { CreateVideoInput } from "@/lib/api/schemas";
import { QUEUE_NAME, VIDEO_BUCKET, requireUuid, storagePathFor } from "./ids";

type VideoRow = {
  id: string;
  org_id: string;
  external_id: string | null;
  contributor_ref: string | null;
  rubric_id: string;
  rubric_version: number;
  status: string;
  storage_path: string | null;
  filename: string | null;
  created_at: string;
};
type DecisionRow = {
  video_id: string;
  decision: string;
  reasons: unknown;
  checks: unknown;
  rubric_id: string;
  rubric_version: number;
  engine_version: string;
  created_at: string;
};
type ReviewRow = { video_id: string; decision: string; note: string | null; created_at: string };
type LabRow = { video_id: string; outcome: string; reason: string | null };

const VIDEO_COLUMNS =
  "id, org_id, external_id, contributor_ref, rubric_id, rubric_version, status, storage_path, filename, created_at";

export type VideoView = ReturnType<typeof serializeVideo>;

export function serializeVideo(
  v: VideoRow,
  decision: DecisionRow | null,
  review: ReviewRow | null,
  lab: LabRow | null,
) {
  return {
    id: v.id,
    external_id: v.external_id,
    status: v.status,
    rubric_id: v.rubric_id,
    rubric_version: v.rubric_version,
    decision: decision && {
      video_id: decision.video_id,
      decision: decision.decision,
      reasons: decision.reasons,
      checks: decision.checks,
      rubric: { id: decision.rubric_id, version: decision.rubric_version },
      engine_version: decision.engine_version,
      created_at: decision.created_at,
    },
    review: review && { decision: review.decision, note: review.note ?? undefined, reviewed_at: review.created_at },
    lab_outcome: lab && { outcome: lab.outcome, reason: lab.reason ?? undefined },
    created_at: v.created_at,
  };
}

/** Latest row per video (rows must arrive newest first). */
function latestBy<T extends { video_id: string }>(rows: T[] | null): Map<string, T> {
  const map = new Map<string, T>();
  for (const row of rows ?? []) if (!map.has(row.video_id)) map.set(row.video_id, row);
  return map;
}

/** Embed the latest decision, latest review and lab outcome into each video. */
export async function attachDetails(db: SupabaseClient, rows: VideoRow[]): Promise<VideoView[]> {
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const [decisions, reviews, labs] = await Promise.all([
    db.from("decisions").select("*").in("video_id", ids).order("created_at", { ascending: false }),
    db.from("reviews").select("*").in("video_id", ids).order("created_at", { ascending: false }),
    db.from("lab_outcomes").select("*").in("video_id", ids),
  ]);
  if (decisions.error || reviews.error || labs.error) throw errors.internal();
  const d = latestBy(decisions.data as DecisionRow[]);
  const r = latestBy(reviews.data as ReviewRow[]);
  const l = latestBy(labs.data as LabRow[]);
  return rows.map((v) => serializeVideo(v, d.get(v.id) ?? null, r.get(v.id) ?? null, l.get(v.id) ?? null));
}

async function findVideoRow(db: SupabaseClient, orgId: string, videoId: string): Promise<VideoRow> {
  requireUuid(videoId, "Video");
  const { data, error } = await db
    .from("videos")
    .select(VIDEO_COLUMNS)
    .eq("id", videoId)
    .eq("org_id", orgId)
    .maybeSingle();
  if (error) throw errors.internal();
  if (!data) throw errors.notFound("Video not found");
  return data as VideoRow;
}

export async function getVideo(db: SupabaseClient, orgId: string, videoId: string): Promise<VideoView> {
  const row = await findVideoRow(db, orgId, videoId);
  return (await attachDetails(db, [row]))[0];
}

export function encodeCursor(row: { created_at: string; id: string }): string {
  return Buffer.from(`${row.created_at}|${row.id}`).toString("base64url");
}

function decodeCursor(cursor: string): { createdAt: string; id: string } {
  const [createdAt, id] = Buffer.from(cursor, "base64url").toString().split("|");
  if (!createdAt || !id || Number.isNaN(Date.parse(createdAt)) || !/^[0-9a-f-]{36}$/i.test(id)) {
    throw errors.badRequest("Invalid cursor");
  }
  return { createdAt, id };
}

export type ListFilters = { status?: string; decision?: string; cursor?: string; limit: number };

/**
 * Newest first, keyset pagination. The `decision` filter applies to the latest decision, which
 * PostgREST cannot express, so we scan batches until the page is full (bounded).
 */
export async function listVideos(db: SupabaseClient, orgId: string, f: ListFilters) {
  const batch = f.decision ? 100 : f.limit + 1;
  const maxBatches = f.decision ? 20 : 1;
  let cursor = f.cursor ? decodeCursor(f.cursor) : null;
  const page: VideoView[] = [];
  let nextCursor: string | null = null;

  for (let i = 0; i < maxBatches && page.length <= f.limit; i++) {
    let q = db.from("videos").select(VIDEO_COLUMNS).eq("org_id", orgId);
    if (f.status) q = q.eq("status", f.status);
    if (cursor) {
      q = q.or(`created_at.lt.${cursor.createdAt},and(created_at.eq.${cursor.createdAt},id.lt.${cursor.id})`);
    }
    const { data, error } = await q
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(batch);
    if (error) throw errors.internal();
    const rows = (data ?? []) as VideoRow[];
    if (!rows.length) break;
    const views = await attachDetails(db, rows);
    for (let j = 0; j < views.length; j++) {
      if (f.decision && views[j].decision?.decision !== f.decision) continue;
      if (page.length === f.limit) {
        // One more match exists beyond the page: continue from the last item returned.
        const last = page[page.length - 1];
        nextCursor = encodeCursor({ created_at: last.created_at, id: last.id });
        return { data: page, next_cursor: nextCursor };
      }
      page.push(views[j]);
    }
    if (rows.length < batch) break;
    cursor = { createdAt: rows[rows.length - 1].created_at, id: rows[rows.length - 1].id };
  }
  return { data: page, next_cursor: nextCursor };
}

export async function createVideo(db: SupabaseClient, orgId: string, input: CreateVideoInput) {
  requireUuid(input.rubric_id, "Rubric");
  const { data: rubric, error: rError } = await db
    .from("rubrics")
    .select("id, current_version")
    .eq("id", input.rubric_id)
    .eq("org_id", orgId)
    .maybeSingle();
  if (rError) throw errors.internal();
  if (!rubric) throw errors.notFound("Rubric not found");

  const version = input.rubric_version ?? rubric.current_version;
  const { data: rv, error: vError } = await db
    .from("rubric_versions")
    .select("version")
    .eq("rubric_id", rubric.id)
    .eq("version", version)
    .maybeSingle();
  if (vError) throw errors.internal();
  if (!rv) throw errors.notFound("Rubric version not found");

  const id = randomUUID();
  const path = storagePathFor(orgId, id, input.filename);
  const { data: row, error } = await db
    .from("videos")
    .insert({
      id,
      org_id: orgId,
      external_id: input.external_id ?? null,
      contributor_ref: input.contributor_ref ?? null,
      rubric_id: rubric.id,
      rubric_version: version,
      status: "awaiting_upload",
      storage_path: path,
      filename: input.filename,
      content_type: input.content_type,
      size_bytes: input.size_bytes,
    })
    .select(VIDEO_COLUMNS)
    .single();
  if (error || !row) {
    if (error?.code === "23505") throw errors.conflict("A video with this external_id already exists");
    throw errors.internal();
  }

  const { data: signed, error: sError } = await db.storage.from(VIDEO_BUCKET).createSignedUploadUrl(path);
  if (sError || !signed) {
    await db.from("videos").delete().eq("id", id);
    throw errors.internal("Could not create an upload URL");
  }

  let lab: LabRow | null = null;
  if (input.lab_outcome) {
    lab = await upsertLabOutcome(db, orgId, id, input.lab_outcome);
  }

  return {
    video: serializeVideo(row as VideoRow, null, null, lab),
    upload_url: signed.signedUrl,
    // Supabase signed upload URLs are valid for two hours.
    upload_expires_at: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
  };
}

async function upsertLabOutcome(
  db: SupabaseClient,
  orgId: string,
  videoId: string,
  input: { outcome: string; reason?: string },
): Promise<LabRow> {
  const { data, error } = await db
    .from("lab_outcomes")
    .upsert(
      { video_id: videoId, org_id: orgId, outcome: input.outcome, reason: input.reason ?? null, received_at: new Date().toISOString() },
      { onConflict: "video_id" },
    )
    .select("video_id, outcome, reason")
    .single();
  if (error || !data) throw errors.internal();
  return data as LabRow;
}

export async function setLabOutcome(
  db: SupabaseClient,
  orgId: string,
  videoId: string,
  input: { outcome: string; reason?: string },
): Promise<VideoView> {
  await findVideoRow(db, orgId, videoId);
  await upsertLabOutcome(db, orgId, videoId, input);
  return getVideo(db, orgId, videoId);
}

export async function reviewVideo(
  db: SupabaseClient,
  orgId: string,
  videoId: string,
  input: { decision: string; note?: string },
  reviewerId: string | null,
): Promise<VideoView> {
  await findVideoRow(db, orgId, videoId);
  const { error } = await db.from("reviews").insert({
    video_id: videoId,
    org_id: orgId,
    reviewer_id: reviewerId,
    decision: input.decision,
    note: input.note ?? null,
  });
  if (error) throw errors.internal();
  return getVideo(db, orgId, videoId);
}

/**
 * Mark the upload finished and queue the analysis. 409 unless the video is awaiting_upload and
 * the file really is in Storage.
 */
export async function completeUpload(db: SupabaseClient, orgId: string, videoId: string): Promise<VideoView> {
  const video = await findVideoRow(db, orgId, videoId);
  if (video.status !== "awaiting_upload") throw errors.conflict(`Video is already ${video.status}`);
  if (!video.storage_path) throw errors.conflict("Video has no file");

  const { data: exists, error: xError } = await db.storage.from(VIDEO_BUCKET).exists(video.storage_path);
  if (xError) throw errors.internal();
  if (!exists) throw errors.conflict("The file has not been uploaded yet");

  // Claim the transition so two concurrent calls cannot both enqueue.
  const { data: claimed, error: cError } = await db
    .from("videos")
    .update({ status: "queued" })
    .eq("id", video.id)
    .eq("status", "awaiting_upload")
    .select("id");
  if (cError) throw errors.internal();
  if (!claimed?.length) throw errors.conflict("Video is no longer awaiting upload");

  const rollback = async (jobId?: string) => {
    if (jobId) await db.from("jobs").delete().eq("id", jobId);
    await db.from("videos").update({ status: "awaiting_upload" }).eq("id", video.id);
  };

  const { data: job, error: jError } = await db
    .from("jobs")
    .insert({ video_id: video.id, status: "queued" })
    .select("id")
    .single();
  if (jError || !job) {
    await rollback();
    throw errors.internal();
  }

  const { error: qError } = await db
    .schema("pgmq_public")
    .rpc("send", { queue_name: QUEUE_NAME, message: { job_id: job.id, video_id: video.id } });
  if (qError) {
    await rollback(job.id);
    throw errors.internal("Could not queue the analysis");
  }
  return getVideo(db, orgId, video.id);
}
