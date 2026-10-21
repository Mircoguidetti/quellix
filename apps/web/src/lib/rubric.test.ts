import { describe, expect, it } from "vitest";
import example from "@quellix/contracts/examples/rubric.load_dishwasher.json";
import { buildRubricBody, validateRubric } from "./rubric";

describe("rubric validation", () => {
  it("accepts the contract example", () => {
    expect(validateRubric(example)).toEqual([]);
  });

  it("builds a body with server-assigned id and version", () => {
    const { name, task, checks } = example;
    const body = buildRubricBody("abc", 2, { name, task, checks });
    expect(body.id).toBe("abc");
    expect(body.version).toBe(2);
  });

  it("rejects a missing task description", () => {
    expect(validateRubric({ ...example, task: {} }).length).toBeGreaterThan(0);
  });

  it("rejects out-of-range thresholds and unknown checks", () => {
    const bad = { ...example, checks: { ...example.checks, hands_visible: { min_ratio: 3 }, nope: {} } };
    expect(validateRubric(bad).length).toBeGreaterThanOrEqual(2);
  });

  it("buildRubricBody throws on an invalid rubric", () => {
    expect(() => buildRubricBody("a", 1, { name: "x", task: {}, checks: {} })).toThrow();
  });
});
