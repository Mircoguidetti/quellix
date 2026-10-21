import { apiContext } from "@/lib/api/context";
import { handle } from "@/lib/api/errors";
import { getVideo } from "@/lib/domain/videos";

export function GET(req: Request, ctx: RouteContext<"/api/v1/videos/[video_id]">) {
  return handle(async () => {
    const { db, orgId } = await apiContext(req);
    const { video_id } = await ctx.params;
    return Response.json(await getVideo(db, orgId, video_id));
  });
}
