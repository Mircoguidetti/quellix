import { connection } from "next/server";
import { apiContext } from "@/lib/api/context";
import { handle } from "@/lib/api/errors";
import { auditResponse, loadAudit, parseAuditQuery } from "@/lib/domain/audit";

/** Lab audit export: per rubric version over a window of days. `format=csv` returns one long table. */
export async function GET(req: Request) {
  // Always computed at request time: never prerendered at build.
  await connection();
  return handle(async () => {
    const { db, orgId } = await apiContext(req);
    const query = parseAuditQuery(new URL(req.url).searchParams);
    const report = await loadAudit(db, orgId, query);
    return auditResponse(report, query.format, query.format === "csv");
  });
}
