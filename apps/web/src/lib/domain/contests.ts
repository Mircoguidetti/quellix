import type { SupabaseClient } from "@supabase/supabase-js";
import { errors } from "@/lib/api/errors";
import { isUuid } from "./ids";

export type PublicContestInfo = { videoId: string; orgId: string; contributorRef: string | null; reasons: string[] };

/** What a contributor may see: only the human-readable reasons of a rejection. Never measurements. */
export async function getContestInfo(db: SupabaseClient, videoId: string): Promise<PublicContestInfo | null> {
  if (!isUuid(videoId)) return null;
  const { data: video } = await db
    .from("videos")
    .select("id, org_id, contributor_ref")
    .eq("id", videoId)
    .maybeSingle();
  if (!video) return null;

  const [{ data: decision }, { data: review }] = await Promise.all([
    db.from("decisions").select("decision, reasons").eq("video_id", videoId).order("created_at", { ascending: false }).limit(1).maybeSingle(),
    db.from("reviews").select("decision").eq("video_id", videoId).order("created_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  const rejected = review ? review.decision === "reject" : decision?.decision === "reject";
  if (!rejected) return null;

  return { videoId, orgId: video.org_id, contributorRef: video.contributor_ref, reasons: contributorReasons(decision?.reasons) };
}

/**
 * What a contributor may read about a rejection: only the reasons that caused it (`effect:
 * reject`). Reasons that only sent the video to review are operational details for the
 * collector's reviewers (issue #8).
 */
export function contributorReasons(reasons: unknown): string[] {
  if (!Array.isArray(reasons)) return [];
  return (reasons as { message?: unknown; effect?: unknown }[])
    .filter((r) => r && r.effect === "reject" && typeof r.message === "string" && r.message)
    .map((r) => r.message as string);
}

export async function submitContest(db: SupabaseClient, info: PublicContestInfo, message: string) {
  const { data: open } = await db
    .from("contests")
    .select("id")
    .eq("video_id", info.videoId)
    .eq("status", "open")
    .limit(1);
  if (open?.length) throw errors.conflict("This rejection is already being contested");
  const { error } = await db.from("contests").insert({
    video_id: info.videoId,
    org_id: info.orgId,
    contributor_ref: info.contributorRef,
    message,
  });
  if (error) throw errors.internal();
}

export type ContestRow = {
  id: string;
  video_id: string;
  contributor_ref: string | null;
  message: string;
  status: "open" | "upheld" | "overturned";
  resolution_note: string | null;
  created_at: string;
  resolved_at: string | null;
  resolved_by?: string | null;
};

export async function getContest(db: SupabaseClient, orgId: string, contestId: string): Promise<ContestRow | null> {
  if (!isUuid(contestId)) return null;
  const { data, error } = await db
    .from("contests")
    .select("id, video_id, contributor_ref, message, status, resolution_note, created_at, resolved_at, resolved_by")
    .eq("id", contestId)
    .eq("org_id", orgId)
    .maybeSingle();
  if (error) throw errors.internal();
  return (data as ContestRow | null) ?? null;
}

export async function listContests(db: SupabaseClient, orgId: string): Promise<ContestRow[]> {
  const { data, error } = await db
    .from("contests")
    .select("id, video_id, contributor_ref, message, status, resolution_note, created_at, resolved_at")
    .eq("org_id", orgId)
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) throw errors.internal();
  return (data ?? []) as ContestRow[];
}

export async function resolveContest(
  db: SupabaseClient,
  orgId: string,
  contestId: string,
  status: "upheld" | "overturned",
  note: string | undefined,
  userId: string,
) {
  const { data, error } = await db
    .from("contests")
    .update({ status, resolution_note: note ?? null, resolved_by: userId, resolved_at: new Date().toISOString() })
    .eq("id", contestId)
    .eq("org_id", orgId)
    .eq("status", "open")
    .select("id");
  if (error) throw errors.internal();
  if (!data?.length) throw errors.conflict("This contest is already resolved");
}
