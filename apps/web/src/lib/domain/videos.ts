import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { errors } from "@/lib/api/errors";
import type { CreateVideoInput } from "@/lib/api/schemas";
import { QUEUE_NAME, VIDEO_BUCKET, requireUuid, storagePathFor } from "./ids";
import { pilotsEnabled } from "@/lib/pilots/flag";

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
  duration_s?: number | null;
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
  "id, org_id, external_id, contributor_ref, rubric_id, rubric_version, status, storage_path, filename, duration_s, created_at";

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

export type ListFilters = {
  status?: string;
  decision?: string;
  cursor?: string;
  limit: number;
  /** Dashboard-only filters. */
  rubricId?: string;
  createdFrom?: string;
  search?: string;
};

/** A video as the API returns it, plus the row fields only the dashboard shows. */
export type VideoItem = { view: VideoView; row: VideoRow };

/** Escape LIKE wildcards in user input so a search is always a plain substring match. */
export function likeSubstring(input: string): string {
  return `%${input.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

/**
 * Newest first, keyset pagination. The `decision` filter applies to the latest decision, which
 * PostgREST cannot express, so we scan batches until the page is full (bounded).
 */
export async function listVideoItems(db: SupabaseClient, orgId: string, f: ListFilters) {
  const batch = f.decision ? 100 : f.limit + 1;
  const maxBatches = f.decision ? 20 : 1;
  let cursor = f.cursor ? decodeCursor(f.cursor) : null;
  const page: VideoItem[] = [];

  for (let i = 0; i < maxBatches && page.length <= f.limit; i++) {
    let q = db.from("videos").select(VIDEO_COLUMNS).eq("org_id", orgId);
    // Shadow pilot videos live in their pilot's report, not in the customer's lists (issue #65).
    if (pilotsEnabled()) q = q.eq("shadow", false);
    if (f.status) q = q.eq("status", f.status);
    if (f.rubricId) q = q.eq("rubric_id", f.rubricId);
    if (f.createdFrom) q = q.gte("created_at", f.createdFrom);
    if (f.search) q = q.ilike("external_id", likeSubstring(f.search));
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
        const last = page[page.length - 1].view;
        return { items: page, next_cursor: encodeCursor({ created_at: last.created_at, id: last.id }) };
      }
      page.push({ view: views[j], row: rows[j] });
    }
    if (rows.length < batch) break;
    cursor = { createdAt: rows[rows.length - 1].created_at, id: rows[rows.length - 1].id };
  }
  return { items: page, next_cursor: null as string | null };
}

export async function listVideos(db: SupabaseClient, orgId: string, f: ListFilters) {
  const { items, next_cursor } = await listVideoItems(db, orgId, f);
  return { data: items.map((i) => i.view), next_cursor };
}

/** `shadow`: a pilot video (issue #65): no webhooks, no contributor feedback, kept out of the usual views. */
export async function createVideo(db: SupabaseClient, orgId: string, input: CreateVideoInput, opts: { shadow?: boolean } = {}) {
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
      // Only written for pilots, so the insert works before the pilots migration exists.
      ...(opts.shadow ? { shadow: true } : {}),
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

/** Records a human decision; returns the review id so the dashboard can offer Undo. */
export async function insertReview(
  db: SupabaseClient,
  orgId: string,
  videoId: string,
  input: { decision: string; note?: string },
  reviewerId: string | null,
): Promise<string> {
  await findVideoRow(db, orgId, videoId);
  const { data, error } = await db
    .from("reviews")
    .insert({ video_id: videoId, org_id: orgId, reviewer_id: reviewerId, decision: input.decision, note: input.note ?? null })
    .select("id")
    .single();
  if (error || !data) throw errors.internal();
  return data.id as string;
}

export const UNDO_WINDOW_MS = 10 * 60 * 1000;

/** Undo a review the same person made a few minutes ago. Older reviews stay: they are history. */
export async function undoReview(db: SupabaseClient, orgId: string, reviewId: string, reviewerId: string) {
  requireUuid(reviewId, "Review");
  const since = new Date(Date.now() - UNDO_WINDOW_MS).toISOString();
  const { data, error } = await db
    .from("reviews")
    .delete()
    .eq("id", reviewId)
    .eq("org_id", orgId)
    .eq("reviewer_id", reviewerId)
    .gte("created_at", since)
    .select("id");
  if (error) throw errors.internal();
  if (!data?.length) throw errors.conflict("This review can no longer be undone");
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

  await enqueueJob(db, video.id, async () => {
    await db.from("videos").update({ status: "awaiting_upload" }).eq("id", video.id);
  });
  return getVideo(db, orgId, video.id);
}

/** Creates the job and puts it on the queue; on failure removes the job and runs `rollback`. */
export async function enqueueJob(db: SupabaseClient, videoId: string, rollback: () => Promise<void>): Promise<void> {
  const { data: job, error: jError } = await db.from("jobs").insert({ video_id: videoId, status: "queued" }).select("id").single();
  if (jError || !job) {
    await rollback();
    throw errors.internal();
  }
  const { error: qError } = await db
    .schema("pgmq_public")
    .rpc("send", { queue_name: QUEUE_NAME, message: { job_id: job.id, video_id: videoId } });
  if (qError) {
    await db.from("jobs").delete().eq("id", job.id);
    await rollback();
    throw errors.internal("Could not queue the analysis");
  }
}

export type ReviewItem = {
  video: VideoView;
  filename: string | null;
  contributorRef: string | null;
  durationS: number | null;
  playbackUrl: string | null;
  /** Why processing failed (latest job error), for videos with status `failed`. */
  failureReason?: string | null;
};

/** The latest job error of each video, for the ones that failed. */
export async function failureReasons(db: SupabaseClient, videoIds: string[]): Promise<Map<string, string | null>> {
  if (!videoIds.length) return new Map();
  const { data, error } = await db
    .from("jobs")
    .select("video_id, error, queued_at")
    .in("video_id", videoIds)
    .order("queued_at", { ascending: false });
  if (error) throw errors.internal();
  const map = new Map<string, string | null>();
  for (const j of data ?? []) if (!map.has(j.video_id as string)) map.set(j.video_id as string, (j.error as string | null) ?? null);
  return map;
}

/** Videos whose newest decision is `review` and that have no human review yet, newest first. */
async function pendingReviewRows(db: SupabaseClient, orgId: string, limit = 100) {
  const { data: decisions, error } = await db
    .from("decisions")
    .select("video_id")
    .eq("org_id", orgId)
    .eq("decision", "review")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw errors.internal();
  const ids = [...new Set((decisions ?? []).map((d) => d.video_id as string))];
  if (!ids.length) return [];

  let vq = db.from("videos").select(VIDEO_COLUMNS).eq("org_id", orgId).in("id", ids);
  // Nobody reviews a shadow pilot video: the collector's reviewers already did (issue #65).
  if (pilotsEnabled()) vq = vq.eq("shadow", false);
  const { data: rows, error: vError } = await vq.order("created_at", { ascending: false });
  if (vError) throw errors.internal();
  const videos = (rows ?? []) as VideoRow[];
  const views = await attachDetails(db, videos);
  return views.flatMap((view, i) => (view.decision?.decision === "review" && !view.review ? [{ view, row: videos[i] }] : []));
}

export async function countReviewQueue(db: SupabaseClient, orgId: string): Promise<number> {
  return (await pendingReviewRows(db, orgId)).length;
}

/** The review queue with a short-lived signed download URL when the file still exists. */
export async function listReviewQueue(db: SupabaseClient, orgId: string): Promise<ReviewItem[]> {
  const pending = await pendingReviewRows(db, orgId);
  return Promise.all(
    pending.map(async ({ view, row }) => ({
      video: view,
      filename: row.filename,
      contributorRef: row.contributor_ref,
      durationS: row.duration_s ?? null,
      playbackUrl: await signedPlayback(db, row.storage_path),
    })),
  );
}

export async function signedPlayback(db: SupabaseClient, path: string | null): Promise<string | null> {
  if (!path) return null;
  const { data } = await db.storage.from(VIDEO_BUCKET).createSignedUrl(path, 600);
  return data?.signedUrl ?? null;
}

/** One video for the dashboard report: the API view plus row fields and playback. */
export async function getVideoItem(db: SupabaseClient, orgId: string, videoId: string): Promise<ReviewItem> {
  const row = await findVideoRow(db, orgId, videoId);
  const [view] = await attachDetails(db, [row]);
  const failure = row.status === "failed" ? (await failureReasons(db, [row.id])).get(row.id) ?? null : null;
  return {
    video: view,
    filename: row.filename,
    contributorRef: row.contributor_ref,
    durationS: row.duration_s ?? null,
    playbackUrl: await signedPlayback(db, row.storage_path),
    failureReason: failure,
  };
}
