import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { errors } from "@/lib/api/errors";
import { chunks, mapLimited, pageAll } from "@/lib/domain/audit";
import { ACCEPTED_CONTENT_TYPES, MAX_UPLOAD_BYTES } from "@/lib/api/schemas";
import { createVideo, enqueueJob, completeUpload } from "@/lib/domain/videos";
import { pilotRowSchema, MAX_PILOT_ROWS } from "@/lib/pilots/csv";
import { computePilotReport, criteriaSchema, type Criterion, type PilotDecisionIn, type PilotItemIn, type PilotReport, type PilotVideoIn } from "@/lib/pilots/report";
import { pilotsEnabled } from "@/lib/pilots/flag";

// Shadow-mode pilots (issue #65). Tables from the proposed migration: `pilots`, `pilot_items`,
// and `videos.shadow` / `videos.source_url`. Every query is scoped by org_id.

const ID_CHUNK = 150;

export type PilotRecord = {
  id: string;
  org_id: string;
  name: string;
  rubric_id: string;
  rubric_version: number;
  criteria: Criterion[];
  default_review_minutes: number | null;
  created_by: string | null;
  created_at: string;
};
export type PilotItemRecord = PilotItemIn & { id: string; pilot_id: string; source_url: string | null };

export const createPilotSchema = z.object({
  name: z.string().trim().min(1, "Give the pilot a name").max(120),
  rubric_id: z.string().uuid("Choose a rubric"),
  rubric_version: z.number().int().min(1).optional(),
  criteria: criteriaSchema,
  default_review_minutes: z.number().min(0.1).max(600).nullable().optional(),
  rows: z.array(pilotRowSchema).min(1, "The CSV has no rows").max(MAX_PILOT_ROWS),
});
export type CreatePilotInput = z.infer<typeof createPilotSchema>;

export function requirePilots() {
  if (!pilotsEnabled()) throw errors.notFound("Pilots are not enabled");
}

export async function listPilots(db: SupabaseClient, orgId: string) {
  requirePilots();
  const { data, error } = await db
    .from("pilots")
    .select("id, name, rubric_id, rubric_version, created_at")
    .eq("org_id", orgId)
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) throw errors.internal();
  const pilots = (data ?? []) as Pick<PilotRecord, "id" | "name" | "rubric_id" | "rubric_version" | "created_at">[];
  if (!pilots.length) return [];
  const [items, rubrics] = await Promise.all([
    pageAll<{ pilot_id: string; video_id: string | null }>(
      (a, b) => db.from("pilot_items").select("pilot_id, video_id").eq("org_id", orgId).in("pilot_id", pilots.map((p) => p.id)).order("id").range(a, b),
      Number.POSITIVE_INFINITY,
    ),
    db.from("rubrics").select("id, name").eq("org_id", orgId),
  ]);
  const videoIds = items.flatMap((i) => (i.video_id ? [i.video_id] : []));
  const decided = new Set<string>();
  await mapLimited(chunks(videoIds, ID_CHUNK), 6, async (chunk) => {
    const { data: rows, error: vError } = await db.from("videos").select("id, status").eq("org_id", orgId).in("id", chunk);
    if (vError) throw errors.internal();
    for (const r of rows ?? []) if (r.status === "decided" || r.status === "deleted") decided.add(r.id as string);
  });
  const names = new Map(((rubrics.data ?? []) as { id: string; name: string }[]).map((r) => [r.id, r.name]));
  return pilots.map((p) => {
    const mine = items.filter((i) => i.pilot_id === p.id);
    return {
      ...p,
      rubric_name: names.get(p.rubric_id) ?? "Deleted rubric",
      videos: mine.length,
      decided: mine.filter((i) => i.video_id && decided.has(i.video_id)).length,
    };
  });
}

export async function getPilot(db: SupabaseClient, orgId: string, pilotId: string): Promise<PilotRecord & { rubric_name: string }> {
  requirePilots();
  if (!z.string().uuid().safeParse(pilotId).success) throw errors.notFound("Pilot not found");
  const { data, error } = await db.from("pilots").select("*").eq("org_id", orgId).eq("id", pilotId).maybeSingle();
  if (error) throw errors.internal();
  if (!data) throw errors.notFound("Pilot not found");
  const { data: rubric } = await db.from("rubrics").select("name").eq("org_id", orgId).eq("id", data.rubric_id).maybeSingle();
  const criteria = criteriaSchema.safeParse(data.criteria);
  return { ...(data as PilotRecord), criteria: criteria.success ? criteria.data : [], rubric_name: (rubric?.name as string) ?? "Deleted rubric" };
}

export async function listPilotItems(db: SupabaseClient, orgId: string, pilotId: string): Promise<PilotItemRecord[]> {
  return pageAll<PilotItemRecord>(
    (a, b) =>
      db
        .from("pilot_items")
        .select("id, pilot_id, external_id, reviewer_decision, reviewer_minutes, lab_outcome, contributor_ref, source_url, video_id")
        .eq("org_id", orgId)
        .eq("pilot_id", pilotId)
        .order("external_id")
        .range(a, b),
    Number.POSITIVE_INFINITY,
  );
}

/**
 * Stores the pilot with its success criteria and the reviewers' decisions, before any video runs.
 * The criteria are never updated afterwards (the migration's trigger enforces it too).
 */
export async function createPilot(db: SupabaseClient, orgId: string, userId: string, input: CreatePilotInput): Promise<string> {
  requirePilots();
  const { data: rubric, error: rError } = await db.from("rubrics").select("id, current_version").eq("org_id", orgId).eq("id", input.rubric_id).maybeSingle();
  if (rError) throw errors.internal();
  if (!rubric) throw errors.notFound("Rubric not found");
  const version = input.rubric_version ?? (rubric.current_version as number);
  const { data: rv } = await db.from("rubric_versions").select("version").eq("rubric_id", rubric.id).eq("version", version).maybeSingle();
  if (!rv) throw errors.notFound("Rubric version not found");

  const { data: pilot, error } = await db
    .from("pilots")
    .insert({
      org_id: orgId,
      name: input.name,
      rubric_id: rubric.id,
      rubric_version: version,
      criteria: input.criteria,
      default_review_minutes: input.default_review_minutes ?? null,
      created_by: userId,
    })
    .select("id")
    .single();
  if (error || !pilot) throw errors.internal();

  for (const part of chunks(input.rows, 500)) {
    const { error: iError } = await db.from("pilot_items").insert(
      part.map((r) => ({
        pilot_id: pilot.id,
        org_id: orgId,
        external_id: r.external_id,
        reviewer_decision: r.reviewer_decision,
        reviewer_minutes: r.reviewer_minutes ?? null,
        lab_outcome: r.lab_outcome ?? null,
        contributor_ref: r.contributor_ref ?? null,
        source_url: r.source_url ?? null,
      })),
    );
    if (iError) {
      await db.from("pilots").delete().eq("id", pilot.id);
      throw errors.internal();
    }
  }
  return pilot.id as string;
}

async function findItem(db: SupabaseClient, orgId: string, pilotId: string, externalId: string) {
  const { data, error } = await db
    .from("pilot_items")
    .select("id, video_id, contributor_ref, source_url")
    .eq("org_id", orgId)
    .eq("pilot_id", pilotId)
    .eq("external_id", externalId)
    .maybeSingle();
  if (error) throw errors.internal();
  if (!data) throw errors.notFound(`No row ${externalId} in this pilot`);
  return data as { id: string; video_id: string | null; contributor_ref: string | null; source_url: string | null };
}

export const pilotUploadSchema = z.object({
  external_id: z.string().min(1).max(200),
  filename: z.string().min(1).max(300),
  content_type: z.enum(ACCEPTED_CONTENT_TYPES),
  size_bytes: z.number().int().min(1).max(MAX_UPLOAD_BYTES),
});

/** A shadow video for one CSV row and a signed URL: the browser uploads straight to Storage. */
export async function startPilotUpload(db: SupabaseClient, orgId: string, pilotId: string, input: z.infer<typeof pilotUploadSchema>) {
  const pilot = await getPilot(db, orgId, pilotId);
  const item = await findItem(db, orgId, pilotId, input.external_id);
  if (item.video_id) throw errors.conflict(`${input.external_id} already has a video`);
  const res = await createVideo(
    db,
    orgId,
    {
      rubric_id: pilot.rubric_id,
      rubric_version: pilot.rubric_version,
      filename: input.filename,
      content_type: input.content_type,
      size_bytes: input.size_bytes,
      contributor_ref: item.contributor_ref ?? undefined,
    },
    { shadow: true },
  );
  // Claim the row; if another tab got there first, drop our video.
  const { data: claimed, error } = await db.from("pilot_items").update({ video_id: res.video.id }).eq("id", item.id).is("video_id", null).select("id");
  if (error || !claimed?.length) {
    await db.from("videos").delete().eq("id", res.video.id);
    throw errors.conflict(`${input.external_id} already has a video`);
  }
  return { videoId: res.video.id, uploadUrl: res.upload_url };
}

export async function finishPilotUpload(db: SupabaseClient, orgId: string, pilotId: string, videoId: string) {
  const { data: item } = await db.from("pilot_items").select("id").eq("org_id", orgId).eq("pilot_id", pilotId).eq("video_id", videoId).maybeSingle();
  if (!item) throw errors.notFound("Video not in this pilot");
  await completeUpload(db, orgId, videoId);
}

/**
 * Rows that point at the collector's own signed URLs: the worker downloads each file to a temporary
 * directory, analyses it and deletes it (proposed worker change, issue #65). Nothing goes through
 * Vercel.
 */
export async function queueUrlItems(db: SupabaseClient, orgId: string, pilotId: string): Promise<number> {
  const pilot = await getPilot(db, orgId, pilotId);
  const items = (await listPilotItems(db, orgId, pilotId)).filter((i) => i.source_url && !i.video_id);
  let queued = 0;
  for (const item of items) {
    const { data: video, error } = await db
      .from("videos")
      .insert({
        org_id: orgId,
        contributor_ref: item.contributor_ref,
        rubric_id: pilot.rubric_id,
        rubric_version: pilot.rubric_version,
        status: "queued",
        storage_path: null,
        filename: decodeURIComponent(new URL(item.source_url!).pathname.split("/").pop() || "video"),
        shadow: true,
        source_url: item.source_url,
      })
      .select("id")
      .single();
    if (error || !video) throw errors.internal();
    const { data: claimed } = await db.from("pilot_items").update({ video_id: video.id }).eq("id", item.id).is("video_id", null).select("id");
    if (!claimed?.length) {
      await db.from("videos").delete().eq("id", video.id);
      continue;
    }
    await enqueueJob(db, video.id as string, async () => {
      await db.from("pilot_items").update({ video_id: null }).eq("id", item.id);
      await db.from("videos").delete().eq("id", video.id);
    });
    queued++;
  }
  return queued;
}

/** Everything the report needs, read in pages and chunks (PostgREST returns at most 1000 rows). */
export async function loadPilotReport(db: SupabaseClient, orgId: string, pilotId: string, now = Date.now()) {
  const pilot = await getPilot(db, orgId, pilotId);
  const items = await listPilotItems(db, orgId, pilotId);
  const ids = items.flatMap((i) => (i.video_id ? [i.video_id] : []));
  const parts = chunks(ids, ID_CHUNK);
  const [videos, decisions] = await Promise.all([
    mapLimited(parts, 6, async (chunk) => {
      const { data, error } = await db.from("videos").select("id, status, duration_s, contributor_ref").eq("org_id", orgId).in("id", chunk);
      if (error) throw errors.internal();
      return (data ?? []) as PilotVideoIn[];
    }).then((p) => p.flat()),
    mapLimited(parts, 6, (chunk) =>
      pageAll<PilotDecisionIn>(
        (a, b) => db.from("decisions").select("video_id, decision, reasons, checks, created_at").eq("org_id", orgId).in("video_id", chunk).order("id").range(a, b),
        Number.POSITIVE_INFINITY,
      ),
    ).then((p) => p.flat()),
  ]);

  // Duplicates point at earlier videos of the same organization: fetch their contributors.
  const matched = new Set<string>();
  for (const d of decisions) {
    const m = (d.checks as Record<string, { measurements?: Record<string, unknown> }> | null)?.originality?.measurements?.match_video_id;
    if (typeof m === "string" && z.string().uuid().safeParse(m).success) matched.add(m);
  }
  const contributors = new Map<string, string | null>();
  for (const v of videos) contributors.set(v.id, items.find((i) => i.video_id === v.id)?.contributor_ref ?? v.contributor_ref);
  const missing = [...matched].filter((id) => !contributors.has(id));
  await mapLimited(chunks(missing, ID_CHUNK), 6, async (chunk) => {
    const { data } = await db.from("videos").select("id, contributor_ref").eq("org_id", orgId).in("id", chunk);
    for (const r of data ?? []) contributors.set(r.id as string, (r.contributor_ref as string | null) ?? null);
  });

  const report: PilotReport = computePilotReport({
    items,
    videos,
    decisions,
    contributors,
    criteria: pilot.criteria,
    defaultMinutes: pilot.default_review_minutes,
    now,
  });
  const awaitingFiles = items.filter((i) => !i.video_id && !i.source_url).map((i) => i.external_id);
  return { pilot, report, awaitingFiles };
}
