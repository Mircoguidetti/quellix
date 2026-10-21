"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { createServerSupabase } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

const nameSchema = z.string().trim().min(1).max(200);

export async function createOrganization(formData: FormData) {
  const supabase = await createServerSupabase();
  const { data } = await supabase.auth.getUser();
  if (!data.user) redirect("/login");

  const name = nameSchema.parse(formData.get("name"));
  const admin = createAdminClient();

  // One organization per user at bootstrap: do nothing if they already belong to one.
  const { count } = await admin
    .from("members")
    .select("*", { count: "exact", head: true })
    .eq("user_id", data.user.id);
  if (!count) {
    const { data: org, error } = await admin.from("organizations").insert({ name }).select("id").single();
    if (error || !org) throw new Error("Could not create the organization");
    const { error: memberError } = await admin
      .from("members")
      .insert({ org_id: org.id, user_id: data.user.id, role: "owner" });
    if (memberError) {
      await admin.from("organizations").delete().eq("id", org.id);
      throw new Error("Could not create the membership");
    }
  }
  redirect("/app");
}
