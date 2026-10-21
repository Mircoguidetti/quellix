import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/server";
import { createAdminClient } from "@/lib/supabase/admin";

export type Role = "owner" | "admin" | "reviewer";
export type Membership = { orgId: string; orgName: string; role: Role };

export type Session = {
  userId: string;
  email: string | undefined;
  name: string | undefined;
  orgId: string;
  orgName: string;
  role: Role;
  memberships: Membership[];
};

export const ORG_COOKIE = "qx_org";

/** Every organization the user belongs to, oldest membership first. */
export async function listMemberships(userId: string): Promise<Membership[]> {
  const db = createAdminClient();
  const { data: rows, error } = await db
    .from("members")
    .select("org_id, role, created_at")
    .eq("user_id", userId)
    .order("created_at");
  if (error) throw new Error("Could not load your organizations");
  if (!rows?.length) return [];
  const { data: orgs, error: orgError } = await db
    .from("organizations")
    .select("id, name")
    .in("id", rows.map((r) => r.org_id));
  if (orgError) throw new Error("Could not load your organizations");
  const names = new Map((orgs ?? []).map((o) => [o.id as string, o.name as string]));
  return rows.flatMap((r) =>
    names.has(r.org_id) ? [{ orgId: r.org_id as string, orgName: names.get(r.org_id)!, role: r.role as Role }] : [],
  );
}

/**
 * The signed-in user and their active organization (from the `qx_org` cookie when it is one of
 * theirs, else the first). Redirects to /login or /onboarding. Cached per request.
 */
export const requireSession = cache(async (): Promise<Session> => {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const memberships = await listMemberships(user.id);
  if (!memberships.length) redirect("/onboarding");
  const preferred = (await cookies()).get(ORG_COOKIE)?.value;
  const active = memberships.find((m) => m.orgId === preferred) ?? memberships[0];
  return {
    userId: user.id,
    email: user.email,
    name: user.name,
    orgId: active.orgId,
    orgName: active.orgName,
    role: active.role,
    memberships,
  };
});
