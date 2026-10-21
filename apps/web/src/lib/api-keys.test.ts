import { describe, expect, it } from "vitest";
import { generateApiKey, hashApiKey } from "./api-keys";

describe("api keys", () => {
  it("generates qx_live_ keys with a matching sha-256 hash and short prefix", () => {
    const { key, prefix, hash } = generateApiKey();
    expect(key.startsWith("qx_live_")).toBe(true);
    expect(key.length).toBeGreaterThan(30);
    expect(key.startsWith(prefix)).toBe(true);
    expect(prefix.length).toBeLessThan(key.length);
    expect(hash).toBe(hashApiKey(key));
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("generates unique keys", () => {
    expect(generateApiKey().key).not.toBe(generateApiKey().key);
  });
});
