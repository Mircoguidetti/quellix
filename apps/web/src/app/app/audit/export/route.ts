import { connection } from "next/server";
import { handle } from "@/lib/api/errors";
import { dashboardContext } from "@/lib/dashboard";
import { auditResponse, loadAudit, parseAuditQuery } from "@/lib/domain/audit";

/** Dashboard download of the audit export (session auth, same report as GET /api/v1/audit). */
export async function GET(req: Request) {
  await connection();
  // Outside handle(): a missing session redirects to /login instead of becoming an error body.
  const { db, orgId } = await dashboardContext();
  return handle(async () => {
    const query = parseAuditQuery(new URL(req.url).searchParams);
    return auditResponse(await loadAudit(db, orgId, query), query.format, true);
  });
}
