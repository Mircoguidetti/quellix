import { describe, expect, it } from "vitest";
import { generateApiKey, hasApiKeyPrefix, hashApiKey } from "./api-keys";

describe("api keys", () => {
  it("generates orm_live_ keys with a matching sha-256 hash and short prefix", () => {
    const { key, prefix, hash } = generateApiKey();
    expect(key.startsWith("orm_live_")).toBe(true);
    expect(key.length).toBeGreaterThan(30);
    expect(key.startsWith(prefix)).toBe(true);
    expect(prefix.length).toBeLessThan(key.length);
    expect(hash).toBe(hashApiKey(key));
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("accepts both prefixes", () => {
    expect(hasApiKeyPrefix("orm_live_abc")).toBe(true);
    expect(hasApiKeyPrefix("qx_live_abc")).toBe(true);
    expect(hasApiKeyPrefix("sk_live_abc")).toBe(false);
  });

  it("generates unique keys", () => {
    expect(generateApiKey().key).not.toBe(generateApiKey().key);
  });
});
