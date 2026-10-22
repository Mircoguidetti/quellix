import type { SupabaseClient } from "@supabase/supabase-js";
import { hashApiKey, hasApiKeyPrefix } from "@/lib/api-keys";
import { errors } from "./errors";

export type ApiContext = { orgId: string; keyId: string };

/** Bearer API-key auth: hash, look up, reject revoked, touch last_used_at. */
export async function authenticate(req: Request, db: SupabaseClient): Promise<ApiContext> {
  const header = req.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(\S+)$/i.exec(header);
  if (!match || !hasApiKeyPrefix(match[1])) throw errors.unauthorized();

  const { data, error } = await db
    .from("api_keys")
    .select("id, org_id, revoked_at")
    .eq("key_hash", hashApiKey(match[1]))
    .maybeSingle();
  if (error) throw errors.internal();
  if (!data || data.revoked_at) throw errors.unauthorized();

  await db.from("api_keys").update({ last_used_at: new Date().toISOString() }).eq("id", data.id);
  return { orgId: data.org_id as string, keyId: data.id as string };
}
