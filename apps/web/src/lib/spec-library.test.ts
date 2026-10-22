import { describe, expect, it } from "vitest";
import { validateRubric } from "./rubric";
import { SPEC_LIBRARY, findTemplate } from "./spec-library";

describe("spec library (issue #28)", () => {
  it.each(SPEC_LIBRARY.map((t) => [t.id, t] as const))("%s is a valid rubric", (_id, t) => {
    expect(validateRubric({ id: t.id, version: 1, ...t.rubric })).toEqual([]);
  });

  it("covers every family and has unique ids", () => {
    expect(new Set(SPEC_LIBRARY.map((t) => t.family))).toEqual(new Set(["kitchen", "laundry", "factory", "common"]));
    expect(new Set(SPEC_LIBRARY.map((t) => t.id)).size).toBe(SPEC_LIBRARY.length);
  });

  it("the common preset matches the public requirements and names what is not checked", () => {
    const t = findTemplate("common-public-spec")!;
    expect(t.rubric.checks.hands_visible.min_ratio).toBe(0.9);
    expect(t.rubric.checks.technical).toMatchObject({ min_fps: 24, min_duration_s: 120 });
    expect(t.unsupported.join(" ")).toMatch(/Landscape[^]*Idle[^]*Staged/);
    expect(findTemplate("nope")).toBeUndefined();
  });
});
