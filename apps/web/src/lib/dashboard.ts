import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireSession } from "@/lib/session";

/**
 * Dashboard data access: the organization comes from the signed-in user's membership, never from
 * the request, and the admin client is always queried with that org id.
 */
export async function dashboardContext() {
  const session = await requireSession();
  return { session, db: createAdminClient(), orgId: session.orgId };
}

/** Same, for actions only owners and admins may take. */
export async function adminContext() {
  const ctx = await dashboardContext();
  if (ctx.session.role === "reviewer") throw new Error("Only owners and admins can do this.");
  return ctx;
}
