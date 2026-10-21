import { apiContext } from "@/lib/api/context";
import { handle, readJson } from "@/lib/api/errors";
import { rubricInputSchema } from "@/lib/api/schemas";
import { createRubric, listRubrics } from "@/lib/domain/rubrics";

export function GET(req: Request) {
  return handle(async () => {
    const { db, orgId } = await apiContext(req);
    return Response.json({ data: await listRubrics(db, orgId) });
  });
}

export function POST(req: Request) {
  return handle(async () => {
    const { db, orgId } = await apiContext(req);
    const input = rubricInputSchema.parse(await readJson(req));
    return Response.json(await createRubric(db, orgId, input, null), { status: 201 });
  });
}
