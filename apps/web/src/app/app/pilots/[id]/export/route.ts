import { connection } from "next/server";
import { z } from "zod";
import { handle } from "@/lib/api/errors";
import { dashboardContext } from "@/lib/dashboard";
import { loadPilotReport } from "@/lib/domain/pilots";
import { pilotToCsv, pilotToPdf } from "@/lib/pilots/export";

const formatSchema = z.enum(["csv", "pdf"]);

function slug(name: string) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "pilot";
}

/** Pilot report download: `?format=csv` (one row per video) or `?format=pdf` (the report). */
export async function GET(req: Request, ctx: RouteContext<"/app/pilots/[id]/export">) {
  await connection();
  // Outside handle(): a missing session redirects to /login instead of becoming an error body.
  const { db, orgId } = await dashboardContext();
  return handle(async () => {
    const { id } = await ctx.params;
    const format = formatSchema.parse(new URL(req.url).searchParams.get("format") ?? "pdf");
    const { pilot, report } = await loadPilotReport(db, orgId, id);
    const base = `ormes-pilot-${slug(pilot.name)}`;
    const headers = { "cache-control": "no-store", "content-disposition": `attachment; filename="${base}.${format}"` };
    if (format === "csv") return new Response(pilotToCsv(report), { headers: { ...headers, "content-type": "text/csv; charset=utf-8" } });
    const pdf = await pilotToPdf(
      { id: pilot.id, name: pilot.name, rubric_name: pilot.rubric_name, rubric_version: pilot.rubric_version, created_at: pilot.created_at },
      report,
    );
    return new Response(Buffer.from(pdf), { headers: { ...headers, "content-type": "application/pdf" } });
  });
}
