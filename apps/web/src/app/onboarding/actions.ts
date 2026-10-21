"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth/server";
import { ORG_COOKIE } from "@/lib/session";
import { createAdminClient } from "@/lib/supabase/admin";

const schema = z.object({ name: z.string().trim().min(2, "Use at least 2 characters.").max(200, "Use at most 200 characters.") });

export type OnboardingResult = { ok: false; error: string };

/**
 * Creates an organization with the user as owner. Without `additional`, it is the first-run
 * bootstrap: a user who already belongs to an organization is just sent to the app.
 */
export async function createOrganization(raw: unknown, additional: boolean): Promise<OnboardingResult> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const input = schema.safeParse(raw);
  if (!input.success) return { ok: false, error: input.error.issues[0]?.message ?? "Check the name." };

  const admin = createAdminClient();
  const { count, error: countError } = await admin
    .from("members")
    .select("*", { count: "exact", head: true })
    .eq("user_id", user.id);
  if (countError) return { ok: false, error: "We could not reach the database. Try again in a moment." };
  if (count && !additional) redirect("/app");

  const { data: org, error } = await admin.from("organizations").insert({ name: input.data.name }).select("id").single();
  if (error || !org) return { ok: false, error: "We could not create the organization. Try again in a moment." };
  const { error: memberError } = await admin.from("members").insert({ org_id: org.id, user_id: user.id, role: "owner" });
  if (memberError) {
    await admin.from("organizations").delete().eq("id", org.id);
    return { ok: false, error: "We could not create the organization. Try again in a moment." };
  }
  (await cookies()).set(ORG_COOKIE, org.id as string, { httpOnly: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 365 });
  redirect("/app");
}
