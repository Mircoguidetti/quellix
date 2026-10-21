"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { dashboardContext } from "@/lib/dashboard";
import { resolveContest } from "@/lib/domain/contests";

const schema = z.object({
  id: z.string().uuid(),
  status: z.enum(["upheld", "overturned"]),
  note: z.string().trim().max(2000).optional(),
});

export async function resolveContestAction(formData: FormData) {
  const { db, orgId, session } = await dashboardContext();
  const input = schema.parse({
    id: formData.get("id"),
    status: formData.get("status"),
    note: String(formData.get("note") ?? "") || undefined,
  });
  await resolveContest(db, orgId, input.id, input.status, input.note, session.userId);
  revalidatePath("/app/contests");
}
