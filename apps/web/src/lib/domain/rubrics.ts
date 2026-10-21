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
