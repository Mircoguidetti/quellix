import { describe, expect, it, vi } from "vitest";
import { KITCHEN_SPEC } from "./fixtures";
import { draftFromSpec } from "./index";
import { buildPrompt, verifyProposals } from "./model";
import { normalizeSource, toLines } from "./source";

const lines = toLines(normalizeSource(KITCHEN_SPEC));
const lineOf = (needle: string) => lines.find((l) => l.text.includes(needle))!.n;

describe("verifying model proposals", () => {
  it("keeps only allowlisted paths, valid values and citations that really are on the line", () => {
    const hands = lineOf("Both hands");
    const out = verifyProposals(lines, {
      fields: [
        { path: "checks.hands_visible.min_ratio", value: 0.9, line: hands, quote: "at least 90% of the time" },
        { path: "checks.hands_visible.orientation", value: "landscape", line: lineOf("landscape"), quote: "landscape" },
        { path: "checks.technical.min_fps", value: 300000, line: lineOf("30 fps"), quote: "30 fps" },
        { path: "checks.technical.min_fps", value: 60, line: lineOf("30 fps"), quote: "60 fps" },
        { path: "checks.privacy.faces", value: "maybe", line: lineOf("faces"), quote: "No faces" },
      ],
      unsupported: [
        { line: lineOf("idle"), quote: "No idle time", note: "Idle" },
        { line: 1, quote: "made up text", note: "x" },
      ],
    });
    expect(out.fields).toEqual([{ path: "checks.hands_visible.min_ratio", value: 0.9, line: hands, quote: "at least 90% of the time", source: "model" }]);
    expect(out.unsupported).toEqual([{ line: lineOf("idle"), quote: "No idle time", note: "Idle" }]);
    expect(out.warnings).toHaveLength(4);
    expect(out.warnings.join(" ")).toContain('"checks.hands_visible.orientation": the rubric has no such field');
    expect(out.warnings.join(" ")).toContain("citation was not found on line");
  });

  it("rejects malformed answers", () => {
    expect(verifyProposals(lines, "nope").warnings[0]).toContain("unreadable");
  });

  it("numbers the lines in the prompt and lists the allowed paths", () => {
    const p = buildPrompt(lines);
    expect(p).toContain(`${lineOf("Both hands")}: - Both hands must be visible`);
    expect(p).toContain("checks.technical.min_fps");
  });
});

function geminiReply(fields: unknown[]) {
  return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify({ fields, unsupported: [] }) }] } }] }), { status: 200 });
}

describe("draftFromSpec", () => {
  it("never calls out without permission", async () => {
    const spy = vi.spyOn(globalThis, "fetch");
    const draft = await draftFromSpec(KITCHEN_SPEC, { useModel: false });
    expect(spy).not.toHaveBeenCalled();
    expect(draft.usedModel).toBe(false);
    expect(draft.rubric.checks.hands_visible.min_ratio).toBe(0.9);
    spy.mockRestore();
  });

  it("lets verified model values win and keeps rule values for the rest", async () => {
    const fetchImpl = vi.fn(async () =>
      geminiReply([
        { path: "checks.technical.min_fps", value_number: 25, line: lineOf("30 fps"), quote: "at least 30 fps" },
        { path: "checks.framing.max_unstable_ratio", value_number: 0.2, line: 1, quote: "invented" },
      ]),
    ) as unknown as typeof fetch;
    const draft = await draftFromSpec(KITCHEN_SPEC, { useModel: true, apiKey: "k", fetchImpl });
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(draft.usedModel).toBe(true);
    const fps = draft.fields.find((f) => f.path === "checks.technical.min_fps")!;
    expect(fps).toMatchObject({ value: 25, source: "model" });
    expect(draft.warnings.join(" ")).toContain("line ");
    expect(draft.rubric.checks.framing).toBeUndefined();
    expect(draft.rubric.checks.hands_visible.min_ratio).toBe(0.9);
  });

  it("falls back to the local rules when the model fails", async () => {
    const fetchImpl = vi.fn(async () => new Response("quota", { status: 429 })) as unknown as typeof fetch;
    const draft = await draftFromSpec(KITCHEN_SPEC, { useModel: true, apiKey: "k", fetchImpl });
    expect(draft.usedModel).toBe(false);
    expect(draft.warnings[0]).toContain("did not answer");
    expect(draft.rubric.checks.technical.min_fps).toBe(30);
  });
});
