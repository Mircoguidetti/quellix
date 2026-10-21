import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { errors } from "@/lib/api/errors";
import { buildRubricBody, type RubricBody, type RubricInput } from "@/lib/rubric";
import { requireUuid } from "./ids";

type RubricRow = { id: string; org_id: string; name: string; current_version: number };

async function findRubric(db: SupabaseClient, orgId: string, rubricId: string): Promise<RubricRow> {
  requireUuid(rubricId, "Rubric");
  const { data, error } = await db
    .from("rubrics")
    .select("id, org_id, name, current_version")
    .eq("id", rubricId)
    .eq("org_id", orgId)
    .maybeSingle();
  if (error) throw errors.internal();
  if (!data) throw errors.notFound("Rubric not found");
  return data as RubricRow;
}

export async function listRubrics(db: SupabaseClient, orgId: string): Promise<RubricBody[]> {
  const { data: rubrics, error } = await db
    .from("rubrics")
    .select("id, current_version")
    .eq("org_id", orgId)
    .order("created_at", { ascending: false });
  if (error) throw errors.internal();
  if (!rubrics?.length) return [];
  const { data: versions, error: vError } = await db
    .from("rubric_versions")
    .select("rubric_id, version, body")
    .in("rubric_id", rubrics.map((r) => r.id));
  if (vError) throw errors.internal();
  const byKey = new Map((versions ?? []).map((v) => [`${v.rubric_id}:${v.version}`, v.body as RubricBody]));
  return rubrics.flatMap((r) => {
    const body = byKey.get(`${r.id}:${r.current_version}`);
    return body ? [body] : [];
  });
}

export async function getRubric(
  db: SupabaseClient,
  orgId: string,
  rubricId: string,
  version?: number,
): Promise<RubricBody> {
  const rubric = await findRubric(db, orgId, rubricId);
  const { data, error } = await db
    .from("rubric_versions")
    .select("body")
    .eq("rubric_id", rubric.id)
    .eq("version", version ?? rubric.current_version)
    .maybeSingle();
  if (error) throw errors.internal();
  if (!data) throw errors.notFound("Rubric version not found");
  return data.body as RubricBody;
}

export async function listRubricVersions(db: SupabaseClient, orgId: string, rubricId: string) {
  const rubric = await findRubric(db, orgId, rubricId);
  const { data } = await db
    .from("rubric_versions")
    .select("version, created_at")
    .eq("rubric_id", rubric.id)
    .order("version", { ascending: false });
  return data ?? [];
}

export async function createRubric(
  db: SupabaseClient,
  orgId: string,
  input: RubricInput,
  userId: string | null,
): Promise<RubricBody> {
  const id = randomUUID();
  const body = buildRubricBody(id, 1, input);
  const { error } = await db.from("rubrics").insert({ id, org_id: orgId, name: input.name, current_version: 1 });
  if (error) throw errors.internal();
  const { error: vError } = await db
    .from("rubric_versions")
    .insert({ rubric_id: id, version: 1, body, created_by: userId });
  if (vError) {
    await db.from("rubrics").delete().eq("id", id);
    throw errors.internal();
  }
  return body;
}

/** Every save is a new version; old versions stay so decisions keep pointing at what they used. */
export async function updateRubric(
  db: SupabaseClient,
  orgId: string,
  rubricId: string,
  input: RubricInput,
  userId: string | null,
): Promise<RubricBody> {
  const rubric = await findRubric(db, orgId, rubricId);
  const version = rubric.current_version + 1;
  const body = buildRubricBody(rubric.id, version, input);
  const { error } = await db
    .from("rubric_versions")
    .insert({ rubric_id: rubric.id, version, body, created_by: userId });
  if (error) {
    if (error.code === "23505") throw errors.conflict("The rubric was updated concurrently; retry");
    throw errors.internal();
  }
  const { error: uError } = await db
    .from("rubrics")
    .update({ name: input.name, current_version: version })
    .eq("id", rubric.id);
  if (uError) throw errors.internal();
  return body;
}

export type RubricSummary = { id: string; name: string; version: number; description: string; libraryId: string | null; updatedAt: string };

/** The list page: current version of each rubric with when it was last saved. */
export async function listRubricSummaries(db: SupabaseClient, orgId: string): Promise<RubricSummary[]> {
  const { data: rubrics, error } = await db
    .from("rubrics")
    .select("id, name, current_version, created_at")
    .eq("org_id", orgId)
    .order("created_at", { ascending: false });
  if (error) throw errors.internal();
  if (!rubrics?.length) return [];
  const { data: versions, error: vError } = await db
    .from("rubric_versions")
    .select("rubric_id, version, body, created_at")
    .in("rubric_id", rubrics.map((r) => r.id));
  if (vError) throw errors.internal();
  const byKey = new Map((versions ?? []).map((v) => [`${v.rubric_id}:${v.version}`, v]));
  return rubrics.flatMap((r) => {
    const v = byKey.get(`${r.id}:${r.current_version}`);
    if (!v) return [];
    const body = v.body as RubricBody;
    return [
      {
        id: r.id as string,
        name: body.name,
        version: body.version,
        description: String((body.task as { description?: string }).description ?? ""),
        libraryId: ((body.task as { library_id?: string }).library_id as string | undefined) ?? null,
        updatedAt: v.created_at as string,
      },
    ];
  });
}

export type RubricVersion = { version: number; created_at: string; body: RubricBody };

/** Every version with its body, newest first, for the editor's history. */
export async function listRubricHistory(db: SupabaseClient, orgId: string, rubricId: string): Promise<RubricVersion[]> {
  const rubric = await findRubric(db, orgId, rubricId);
  const { data, error } = await db
    .from("rubric_versions")
    .select("version, created_at, body")
    .eq("rubric_id", rubric.id)
    .order("version", { ascending: false });
  if (error) throw errors.internal();
  return (data ?? []) as RubricVersion[];
}

export type StoredDecisionChecks = { decision: string; checks: Record<string, { status?: string; measurements?: Record<string, unknown>; model?: string }> };

/**
 * Recent decisions to preview an edited rubric on: this rubric's when it has any, otherwise the
 * organization's. Measurements do not depend on the rubric, so any of them can be re-evaluated.
 */
export async function recentDecisionChecks(db: SupabaseClient, orgId: string, rubricId: string | null, limit = 200): Promise<{ scope: "rubric" | "organization"; rows: StoredDecisionChecks[] }> {
  if (rubricId) {
    const { data, error } = await db
      .from("decisions")
      .select("decision, checks, created_at")
      .eq("org_id", orgId)
      .eq("rubric_id", rubricId)
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error) throw errors.internal();
    if (data?.length) return { scope: "rubric", rows: data as StoredDecisionChecks[] };
  }
  const { data, error } = await db
    .from("decisions")
    .select("decision, checks, created_at")
    .eq("org_id", orgId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw errors.internal();
  return { scope: "organization", rows: (data ?? []) as StoredDecisionChecks[] };
}
