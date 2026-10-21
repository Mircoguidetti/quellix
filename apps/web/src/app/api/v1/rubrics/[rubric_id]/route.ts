import { apiContext } from "@/lib/api/context";
import { errors, handle, readJson } from "@/lib/api/errors";
import { rubricInputSchema } from "@/lib/api/schemas";
import { getRubric, updateRubric } from "@/lib/domain/rubrics";

export function GET(req: Request, ctx: RouteContext<"/api/v1/rubrics/[rubric_id]">) {
  return handle(async () => {
    const { db, orgId } = await apiContext(req);
    const { rubric_id } = await ctx.params;
    const raw = new URL(req.url).searchParams.get("version");
    let version: number | undefined;
    if (raw !== null) {
      version = Number(raw);
      if (!Number.isInteger(version) || version < 1) throw errors.badRequest("version must be a positive integer");
    }
    return Response.json(await getRubric(db, orgId, rubric_id, version));
  });
}

export function PUT(req: Request, ctx: RouteContext<"/api/v1/rubrics/[rubric_id]">) {
  return handle(async () => {
    const { db, orgId } = await apiContext(req);
    const { rubric_id } = await ctx.params;
    const input = rubricInputSchema.parse(await readJson(req));
    return Response.json(await updateRubric(db, orgId, rubric_id, input, null));
  });
}
