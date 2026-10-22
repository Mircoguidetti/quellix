import { describe, expect, it } from "vitest";
import { authenticate } from "./auth";
import { ApiError } from "./errors";
import { KEY, LEGACY_KEY, ORG, createFakeDb, type Call } from "@/test/fake-supabase";
import { hashApiKey } from "@/lib/api-keys";

const req = (authorization?: string) =>
  new Request("http://localhost/api/v1/videos", { headers: authorization ? { authorization } : {} });

async function status(p: Promise<unknown>) {
  try {
    await p;
    return 200;
  } catch (e) {
    return e instanceof ApiError ? e.status : 500;
  }
}

describe("authenticate", () => {
  it("accepts a valid key, looks it up by hash and touches last_used_at", async () => {
    const { db, calls } = createFakeDb((c) =>
      c.table === "api_keys" && c.op === "select" ? { data: { id: "k", org_id: ORG, revoked_at: null }, error: null } : undefined,
    );
    await expect(authenticate(req(`Bearer ${KEY}`), db)).resolves.toEqual({ orgId: ORG, keyId: "k" });
    const lookup = calls.find((c: Call) => c.op === "select")!;
    expect(lookup.filters).toContainEqual(["eq:key_hash", hashApiKey(KEY)]);
    expect(calls.some((c) => c.op === "update" && "last_used_at" in (c.payload as object))).toBe(true);
  });

  it("rejects a missing header, a wrong scheme and a key without the orm_live_ or qx_live_ prefix", async () => {
    const { db } = createFakeDb(() => undefined);
    expect(await status(authenticate(req(), db))).toBe(401);
    expect(await status(authenticate(req(`Basic ${KEY}`), db))).toBe(401);
    expect(await status(authenticate(req("Bearer sk_other_123"), db))).toBe(401);
  });

  it("still accepts a key issued before the rename (qx_live_ prefix)", async () => {
    const { db, calls } = createFakeDb((c) =>
      c.table === "api_keys" && c.op === "select" ? { data: { id: "k", org_id: ORG, revoked_at: null }, error: null } : undefined,
    );
    await expect(authenticate(req(`Bearer ${LEGACY_KEY}`), db)).resolves.toEqual({ orgId: ORG, keyId: "k" });
    expect(calls.find((c: Call) => c.op === "select")!.filters).toContainEqual(["eq:key_hash", hashApiKey(LEGACY_KEY)]);
  });

  it("rejects an unknown key", async () => {
    const { db } = createFakeDb(() => ({ data: null, error: null }));
    expect(await status(authenticate(req(`Bearer ${KEY}`), db))).toBe(401);
  });

  it("rejects a revoked key and does not touch last_used_at", async () => {
    const { db, calls } = createFakeDb(() => ({ data: { id: "k", org_id: ORG, revoked_at: "2026-01-01T00:00:00Z" }, error: null }));
    expect(await status(authenticate(req(`Bearer ${KEY}`), db))).toBe(401);
    expect(calls.some((c) => c.op === "update")).toBe(false);
  });
});
