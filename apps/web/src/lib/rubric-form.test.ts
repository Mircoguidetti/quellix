import { describe, expect, it } from "vitest";
import example from "@quellix/contracts/examples/rubric.load_dishwasher.json";
import { validateRubric } from "./rubric";
import { rubricFormSchema, summarizeRules, toFormValues, toRubricInput } from "./rubric-form";

describe("rubric editor form model", () => {
  it("round-trips the contract example into a valid rubric", () => {
    const values = toFormValues(example);
    expect(rubricFormSchema.safeParse(values).success).toBe(true);
    const input = toRubricInput(values);
    expect(validateRubric({ id: "x", version: 1, ...input })).toEqual([]);
    expect(input.task.steps).toEqual(example.task.steps);
    expect((input.checks.technical as Record<string, unknown>).min_width).toBe(1280);
  });

  it("fills schema defaults for checks the body leaves out", () => {
    const values = toFormValues({ name: "x", task: { description: "y" }, checks: {} });
    expect(values.checks.hands_visible.min_ratio).toBe(0.8);
    expect(values.checks.framing.critical).toBe(false);
    expect("min_duration_s" in values.checks.technical).toBe(false);
    expect(validateRubric({ id: "x", version: 1, ...toRubricInput(values) })).toEqual([]);
  });

  it("rejects a max duration below the min duration", () => {
    const values = toFormValues(example);
    values.checks.technical.max_duration_s = 10;
    const res = rubricFormSchema.safeParse(values);
    expect(res.success).toBe(false);
    expect(res.error?.issues[0].path).toEqual(["checks", "technical", "max_duration_s"]);
  });

  it("summarizes what rejects and what goes to review", () => {
    const values = toFormValues(example);
    values.checks.privacy.documents = "reject";
    const rules = summarizeRules(values);
    expect(rules.rejects).toContain("both hands are visible less than 80% of the time during manipulation");
    expect(rules.rejects).toContain("a readable document is visible");
    expect(rules.reviews).toContain("a face is visible");
    expect(rules.reviews.some((r) => r.startsWith("the camera points away"))).toBe(true);
  });
});
