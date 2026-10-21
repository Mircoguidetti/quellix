import { z } from "zod";
import { errors, handle, readJson } from "@/lib/api/errors";
import { getContestInfo, submitContest } from "@/lib/domain/contests";
import { rateLimited } from "@/lib/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";

const bodySchema = z.object({ message: z.string().trim().min(1).max(4000) });

/** Public: a contributor contests a rejection. The video id in the link is the capability. */
export function POST(req: Request, ctx: RouteContext<"/api/contest/[videoId]">) {
  return handle(async () => {
    const { videoId } = await ctx.params;
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
    if (rateLimited(`contest:${ip}`, 10) || rateLimited(`contest:${videoId}`, 3)) {
      return Response.json({ error: { code: "rate_limited", message: "Too many requests, try again later" } }, { status: 429 });
    }
    const { message } = bodySchema.parse(await readJson(req));
    const db = createAdminClient();
    const info = await getContestInfo(db, videoId);
    if (!info) throw errors.notFound("Nothing to contest here");
    await submitContest(db, info, message);
    return Response.json({ ok: true }, { status: 201 });
  });
}
