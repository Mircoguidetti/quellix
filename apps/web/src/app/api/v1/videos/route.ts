import { apiContext } from "@/lib/api/context";
import { handle, readJson } from "@/lib/api/errors";
import { createVideoSchema, listVideosQuerySchema } from "@/lib/api/schemas";
import { createVideo, listVideos } from "@/lib/domain/videos";

export function POST(req: Request) {
  return handle(async () => {
    const { db, orgId } = await apiContext(req);
    const input = createVideoSchema.parse(await readJson(req));
    return Response.json(await createVideo(db, orgId, input), { status: 201 });
  });
}

export function GET(req: Request) {
  return handle(async () => {
    const { db, orgId } = await apiContext(req);
    const query = listVideosQuerySchema.parse(Object.fromEntries(new URL(req.url).searchParams));
    return Response.json(await listVideos(db, orgId, query));
  });
}
