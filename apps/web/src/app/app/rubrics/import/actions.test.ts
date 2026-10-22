import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeDb } from "@/test/fake-supabase";
import { KITCHEN_SPEC } from "@/lib/spec-import/fixtures";

let orgAllows = false;
let role = "owner";
vi.mock("@/lib/dashboard", () => ({
  dashboardContext: async () => ({
    db: createFakeDb((c) => (c.table === "organizations" ? { data: { allow_external_models: orgAllows }, error: null } : undefined)).db,
    orgId: "org-1",
    session: { role, userId: "u1" },
  }),
}));

const { importSpec } = await import("./actions");

const gemini = () =>
  new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify({ fields: [], unsupported: [] }) }] } }] }), { status: 200 });

describe("importSpec permission gate (issue #28)", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => gemini());
    vi.stubEnv("QUELLIX_ALLOW_EXTERNAL_MODELS", "1");
    vi.stubEnv("GEMINI_API_KEY", "test-key");
    orgAllows = false;
    role = "owner";
  });
  afterEach(() => {
    fetchSpy.mockRestore();
    vi.unstubAllEnvs();
  });

  it("does not send the text out when the organization has not allowed external models", async () => {
    const res = await importSpec({ text: KITCHEN_SPEC, useModel: true });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(res.ok && res.draft.usedModel).toBe(false);
    expect(res.ok && res.draft.warnings[0]).toContain("not allowed");
  });

  it("does not send the text out when the deployment kill switch is off", async () => {
    orgAllows = true;
    vi.stubEnv("QUELLIX_ALLOW_EXTERNAL_MODELS", "");
    await importSpec({ text: KITCHEN_SPEC, useModel: true });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("does not send the text out when the user did not ask for it", async () => {
    orgAllows = true;
    const res = await importSpec({ text: KITCHEN_SPEC, useModel: false });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(res.ok && res.draft.rubric.checks.hands_visible.min_ratio).toBe(0.9);
  });

  it("calls the model only when the user, the organization and the deployment all allow it", async () => {
    orgAllows = true;
    const res = await importSpec({ text: KITCHEN_SPEC, useModel: true });
    expect(fetchSpy).toHaveBeenCalledOnce();
    expect(String(fetchSpy.mock.calls[0][0])).toContain("generativelanguage.googleapis.com");
    expect(res.ok && res.draft.usedModel).toBe(true);
  });

  it("refuses reviewers and too-short input", async () => {
    role = "reviewer";
    expect(await importSpec({ text: KITCHEN_SPEC, useModel: false })).toEqual({ ok: false, error: "Only owners and admins can create rubrics." });
    role = "owner";
    const res = await importSpec({ text: "hi", useModel: false });
    expect(res.ok).toBe(false);
  });
});
