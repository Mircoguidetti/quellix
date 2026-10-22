"use server";

import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { generateApiKey } from "@/lib/api-keys";
import { adminContext } from "@/lib/dashboard";
import { siteUrl } from "@/lib/env";

type Ok<T = object> = ({ ok: true } & T) | { ok: false; error: string };

const FORBIDDEN = "Only owners and admins can change settings.";

async function guarded<T extends object>(fn: (ctx: Awaited<ReturnType<typeof adminContext>>) => Promise<Ok<T>>, fallback: string): Promise<Ok<T>> {
  let ctx;
  try {
    ctx = await adminContext();
  } catch {
    return { ok: false, error: FORBIDDEN };
  }
  try {
    const res = await fn(ctx);
    revalidatePath("/app/settings");
    return res;
  } catch (e) {
    return { ok: false, error: e instanceof z.ZodError ? (e.issues[0]?.message ?? fallback) : fallback };
  }
}

/** The full key is returned once and never stored; only its SHA-256 hash and a short prefix are. */
export async function createApiKey(name: string): Promise<Ok<{ key: string }>> {
  return guarded(async ({ db, orgId, session }) => {
    const clean = z.string().trim().min(1, "Give the key a name.").max(100, "Use at most 100 characters.").parse(name);
    const { key, prefix, hash } = generateApiKey();
    const { error } = await db.from("api_keys").insert({ org_id: orgId, name: clean, prefix, key_hash: hash, created_by: session.userId });
    if (error) throw new Error("insert");
    return { ok: true, key };
  }, "We could not create the key. Try again.");
}

export async function revokeApiKey(id: string): Promise<Ok> {
  return guarded(async ({ db, orgId }) => {
    const { error } = await db
      .from("api_keys")
      .update({ revoked_at: new Date().toISOString() })
      .eq("id", z.string().uuid().parse(id))
      .eq("org_id", orgId)
      .is("revoked_at", null);
    if (error) throw new Error("update");
    return { ok: true };
  }, "We could not revoke the key. Try again.");
}

export async function addWebhook(url: string): Promise<Ok<{ secret: string }>> {
  return guarded(async ({ db, orgId }) => {
    const clean = z
      .string()
      .trim()
      .url("Enter a full URL, like https://example.com/hooks/ormes.")
      .refine((u) => u.startsWith("https://"), "Webhook URLs must use https.")
      .parse(url);
    const secret = `whsec_${randomBytes(24).toString("base64url")}`;
    const { error } = await db.from("webhooks").insert({ org_id: orgId, url: clean, signing_secret: secret });
    if (error) throw new Error("insert");
    return { ok: true, secret };
  }, "We could not save the webhook. Try again.");
}

export async function setWebhookActive(id: string, active: boolean): Promise<Ok> {
  return guarded(async ({ db, orgId }) => {
    const { error } = await db.from("webhooks").update({ active }).eq("id", z.string().uuid().parse(id)).eq("org_id", orgId);
    if (error) throw new Error("update");
    return { ok: true };
  }, "We could not update the webhook. Try again.");
}

export async function deleteWebhook(id: string): Promise<Ok> {
  return guarded(async ({ db, orgId }) => {
    const { error } = await db.from("webhooks").delete().eq("id", z.string().uuid().parse(id)).eq("org_id", orgId);
    if (error) throw new Error("delete");
    return { ok: true };
  }, "We could not delete the webhook. Try again.");
}

/** Third-party models (Gemini, TwelveLabs) may only see this organization's videos when this is on. */
export async function setAllowExternalModels(allow: boolean): Promise<Ok> {
  return guarded(async ({ db, orgId }) => {
    const { error } = await db.from("organizations").update({ allow_external_models: z.boolean().parse(allow) }).eq("id", orgId);
    if (error) throw new Error("update");
    return { ok: true };
  }, "We could not change this setting. Try again.");
}

const roleSchema = z.enum(["owner", "admin", "reviewer"]);

export async function inviteMember(email: string, role: string): Promise<Ok<{ existing: boolean }>> {
  return guarded<{ existing: boolean }>(async ({ db, orgId, session }) => {
    const address = z.string().trim().toLowerCase().email("Enter a valid email address.").parse(email);
    const r = roleSchema.parse(role);
    if (r === "owner" && session.role !== "owner") return { ok: false, error: "Only owners can add another owner." };
    let userId: string | null = null;
    let existing = false;
    const invited = await db.auth.admin.inviteUserByEmail(address, { redirectTo: `${siteUrl()}/auth/callback?next=/reset-password` });
    if (invited.data?.user) userId = invited.data.user.id;
    else {
      // Already has an Ormes account: add them directly.
      const { data } = await db.auth.admin.listUsers({ perPage: 1000 });
      const found = data?.users.find((u) => u.email?.toLowerCase() === address);
      if (!found) return { ok: false, error: "We could not send the invitation. Try again." };
      userId = found.id;
      existing = true;
    }
    const { error } = await db.from("members").insert({ org_id: orgId, user_id: userId, role: r });
    if (error) return { ok: false, error: error.code === "23505" ? "This person is already in the team." : "We could not add this person. Try again." };
    return { ok: true, existing };
  }, "We could not send the invitation. Try again.");
}

async function owners(db: Awaited<ReturnType<typeof adminContext>>["db"], orgId: string) {
  const { data } = await db.from("members").select("user_id").eq("org_id", orgId).eq("role", "owner");
  return (data ?? []).map((m) => m.user_id as string);
}

export async function changeRole(userId: string, role: string): Promise<Ok> {
  return guarded(async ({ db, orgId, session }) => {
    const id = z.string().uuid().parse(userId);
    const r = roleSchema.parse(role);
    if (r === "owner" && session.role !== "owner") return { ok: false, error: "Only owners can make someone an owner." };
    const currentOwners = await owners(db, orgId);
    if (currentOwners.includes(id) && session.role !== "owner") return { ok: false, error: "Only owners can change an owner's role." };
    if (currentOwners.length === 1 && currentOwners[0] === id && r !== "owner") return { ok: false, error: "Every organization needs an owner. Make someone else owner first." };
    const { error } = await db.from("members").update({ role: r }).eq("org_id", orgId).eq("user_id", id);
    if (error) throw new Error("update");
    return { ok: true };
  }, "We could not change the role. Try again.");
}

export async function removeMember(userId: string): Promise<Ok> {
  return guarded(async ({ db, orgId, session }) => {
    const id = z.string().uuid().parse(userId);
    if (id === session.userId) return { ok: false, error: "You cannot remove yourself. Ask another owner." };
    const currentOwners = await owners(db, orgId);
    if (currentOwners.includes(id) && session.role !== "owner") return { ok: false, error: "Only owners can remove an owner." };
    const { error } = await db.from("members").delete().eq("org_id", orgId).eq("user_id", id);
    if (error) throw new Error("delete");
    return { ok: true };
  }, "We could not remove this person. Try again.");
}
