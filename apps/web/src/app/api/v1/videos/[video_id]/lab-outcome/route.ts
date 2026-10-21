import { apiContext } from "@/lib/api/context";
import { handle, readJson } from "@/lib/api/errors";
import { labOutcomeSchema } from "@/lib/api/schemas";
import { setLabOutcome } from "@/lib/domain/videos";

export function POST(req: Request, ctx: RouteContext<"/api/v1/videos/[video_id]/lab-outcome">) {
  return handle(async () => {
    const { db, orgId } = await apiContext(req);
    const { video_id } = await ctx.params;
    const input = labOutcomeSchema.parse(await readJson(req));
    return Response.json(await setLabOutcome(db, orgId, video_id, input));
  });
}
