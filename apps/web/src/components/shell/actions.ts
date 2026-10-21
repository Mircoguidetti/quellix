"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { ORG_COOKIE, requireSession } from "@/lib/session";

export async function switchOrganization(orgId: string) {
  const id = z.string().uuid().parse(orgId);
  const session = await requireSession();
  if (!session.memberships.some((m) => m.orgId === id)) throw new Error("Not a member of this organization");
  (await cookies()).set(ORG_COOKIE, id, { httpOnly: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 365 });
  redirect("/app");
}

export async function setSidebarCollapsed(collapsed: boolean) {
  (await cookies()).set("qx_sidebar", collapsed ? "collapsed" : "open", { sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 365 });
}
