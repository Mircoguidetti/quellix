"use server";

import { createHash, randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { generateApiKey } from "@/lib/api-keys";
import { dashboardContext } from "@/lib/dashboard";

async function adminContext() {
  const ctx = await dashboardContext();
  if (ctx.session.role === "reviewer") throw new Error("Only owners and admins can change settings");
  return ctx;
}

export type CreateKeyResult = { ok: true; key: string } | { ok: false; error: string };

/** The full key is returned once and never stored; only its SHA-256 hash and a short prefix are. */
export async function createApiKey(formData: FormData): Promise<CreateKeyResult> {
  try {
    const { db, orgId, session } = await adminContext();
    const name = z.string().trim().min(1).max(100).parse(formData.get("name"));
    const { key, prefix, hash } = generateApiKey();
    const { error } = await db
      .from("api_keys")
      .insert({ org_id: orgId, name, prefix, key_hash: hash, created_by: session.userId });
    if (error) throw new Error("Could not create the key");
    revalidatePath("/app/settings");
    return { ok: true, key };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not create the key" };
  }
}

export async function revokeApiKey(formData: FormData) {
  const { db, orgId } = await adminContext();
  const id = z.string().uuid().parse(formData.get("id"));
  await db
    .from("api_keys")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", id)
    .eq("org_id", orgId)
    .is("revoked_at", null);
  revalidatePath("/app/settings");
}

export type AddWebhookResult = { ok: true; secret: string } | { ok: false; error: string };

export async function addWebhook(formData: FormData): Promise<AddWebhookResult> {
  try {
    const { db, orgId } = await adminContext();
    const url = z
      .string()
      .url()
      .refine((u) => u.startsWith("https://"), "Webhook URLs must use https")
      .parse(String(formData.get("url") ?? "").trim());
    const secret = `whsec_${randomBytes(24).toString("base64url")}`;
    const { error } = await db
      .from("webhooks")
      .insert({ org_id: orgId, url, secret_hash: createHash("sha256").update(secret).digest("hex") });
    if (error) throw new Error("Could not save the webhook");
    revalidatePath("/app/settings");
    return { ok: true, secret };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not save the webhook" };
  }
}

export async function toggleWebhook(formData: FormData) {
  const { db, orgId } = await adminContext();
  const id = z.string().uuid().parse(formData.get("id"));
  const active = formData.get("active") === "true";
  await db.from("webhooks").update({ active }).eq("id", id).eq("org_id", orgId);
  revalidatePath("/app/settings");
}

export async function deleteWebhook(formData: FormData) {
  const { db, orgId } = await adminContext();
  const id = z.string().uuid().parse(formData.get("id"));
  await db.from("webhooks").delete().eq("id", id).eq("org_id", orgId);
  revalidatePath("/app/settings");
}
