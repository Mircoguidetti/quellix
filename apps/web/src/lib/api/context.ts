import { createAdminClient } from "@/lib/supabase/admin";
import { authenticate } from "./auth";

/** Admin client + the organization the Bearer key belongs to. Every query is scoped by orgId. */
export async function apiContext(req: Request) {
  const db = createAdminClient();
  const { orgId } = await authenticate(req, db);
  return { db, orgId };
}
