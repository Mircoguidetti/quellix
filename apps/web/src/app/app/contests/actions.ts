"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { ApiError } from "@/lib/api/errors";
import { dashboardContext } from "@/lib/dashboard";
import { resolveContest } from "@/lib/domain/contests";

const schema = z.object({
  status: z.enum(["upheld", "overturned"]),
  note: z.string().trim().max(2000).optional(),
});

export async function resolveContestAction(contestId: string, raw: unknown): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const { db, orgId, session } = await dashboardContext();
    const id = z.string().uuid().parse(contestId);
    const input = schema.parse(raw);
    await resolveContest(db, orgId, id, input.status, input.note || undefined, session.userId);
    revalidatePath("/app/contests");
    revalidatePath(`/app/contests/${id}`);
    return { ok: true };
  } catch (e) {
    if (e instanceof ApiError && e.status === 409) return { ok: false, error: "Someone already resolved this contest." };
    return { ok: false, error: "We could not save the resolution. Try again." };
  }
}
