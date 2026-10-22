import { createHash, randomBytes } from "node:crypto";

/** New keys. */
export const API_KEY_PREFIX = "orm_live_";
/** Keys issued before the rename keep working. */
export const LEGACY_API_KEY_PREFIX = "qx_live_";

export function hasApiKeyPrefix(key: string): boolean {
  return key.startsWith(API_KEY_PREFIX) || key.startsWith(LEGACY_API_KEY_PREFIX);
}

export type GeneratedKey = { key: string; prefix: string; hash: string };

export function hashApiKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

export function generateApiKey(): GeneratedKey {
  const key = `${API_KEY_PREFIX}${randomBytes(24).toString("base64url")}`;
  // Shown in the dashboard to recognise a key; short enough not to help guessing.
  return { key, prefix: key.slice(0, API_KEY_PREFIX.length + 6), hash: hashApiKey(key) };
}
