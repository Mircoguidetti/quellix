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

export function explainStatus(status: string): string {
  return (
    {
      awaiting_upload: "Waiting for the file",
      queued: "Queued",
      processing: "Analysing",
      decided: "Decided",
      failed: "Failed",
      deleted: "File deleted",
    } as Record<string, string>
  )[status] ?? status;
}
