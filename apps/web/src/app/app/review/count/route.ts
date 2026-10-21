import { connection } from "next/server";
import { dashboardContext } from "@/lib/dashboard";
import { countReviewQueue } from "@/lib/domain/videos";

/** The sidebar's live Review badge polls this. */
export async function GET() {
  await connection();
  try {
    const { db, orgId } = await dashboardContext();
    return Response.json({ count: await countReviewQueue(db, orgId) }, { headers: { "cache-control": "no-store" } });
  } catch {
    return Response.json({ error: "unavailable" }, { status: 503 });
  }
}
