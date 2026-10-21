import { apiContext } from "@/lib/api/context";
import { handle } from "@/lib/api/errors";
import { completeUpload } from "@/lib/domain/videos";

export function POST(req: Request, ctx: RouteContext<"/api/v1/videos/[video_id]/complete">) {
  return handle(async () => {
    const { db, orgId } = await apiContext(req);
    const { video_id } = await ctx.params;
    return Response.json(await completeUpload(db, orgId, video_id), { status: 202 });
  });
}
