import { createHash, randomBytes } from "node:crypto";

export const API_KEY_PREFIX = "qx_live_";

export type GeneratedKey = { key: string; prefix: string; hash: string };

export function hashApiKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

export function generateApiKey(): GeneratedKey {
  const key = `${API_KEY_PREFIX}${randomBytes(24).toString("base64url")}`;
  // Shown in the dashboard to recognise a key; short enough not to help guessing.
  return { key, prefix: key.slice(0, API_KEY_PREFIX.length + 6), hash: hashApiKey(key) };
}
