import { redirect } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";

export type Session = {
  userId: string;
  email: string | undefined;
  orgId: string;
  orgName: string;
  role: "owner" | "admin" | "reviewer";
};

/** The signed-in user and their first organization; redirects to /login or /onboarding. */
export async function requireSession(): Promise<Session> {
  const supabase = await createServerSupabase();
  const { data } = await supabase.auth.getUser();
  if (!data.user) redirect("/login");
  const { data: rows } = await supabase
    .from("members")
    .select("role, organizations(id, name)")
    .eq("user_id", data.user.id)
    .order("created_at")
    .limit(1);
  const row = rows?.[0] as unknown as
    | { role: Session["role"]; organizations: { id: string; name: string } | null }
    | undefined;
  if (!row?.organizations) redirect("/onboarding");
  return {
    userId: data.user.id,
    email: data.user.email,
    orgId: row.organizations.id,
    orgName: row.organizations.name,
    role: row.role,
  };
}
