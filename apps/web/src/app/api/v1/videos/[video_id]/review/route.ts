import { apiContext } from "@/lib/api/context";
import { handle, readJson } from "@/lib/api/errors";
import { reviewSchema } from "@/lib/api/schemas";
import { reviewVideo } from "@/lib/domain/videos";

export function POST(req: Request, ctx: RouteContext<"/api/v1/videos/[video_id]/review">) {
  return handle(async () => {
    const { db, orgId } = await apiContext(req);
    const { video_id } = await ctx.params;
    const input = reviewSchema.parse(await readJson(req));
    return Response.json(await reviewVideo(db, orgId, video_id, input, null));
  });
}
