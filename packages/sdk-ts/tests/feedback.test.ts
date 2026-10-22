import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { GENERIC_HIDDEN_MESSAGE, contributorFeedback, isContributorVisible, type Decision } from "../src";

const examples = new URL("../../contracts/examples/", import.meta.url);
const decision = JSON.parse(readFileSync(new URL("decision.feedback.json", examples), "utf8")) as Decision;
const expected = JSON.parse(readFileSync(new URL("decision.feedback.expected.json", examples), "utf8")) as unknown;

describe("contributorFeedback", () => {
  it("matches the shared vectors from the contract", () => {
    expect(contributorFeedback(decision)).toEqual(expected);
  });

  it.each([true, false, undefined])("never shows a duplicate (contributor_visible=%s)", (flag) => {
    const reason = {
      check: "originality",
      code: "originality.duplicate",
      message: "Matches video abc.",
      effect: "reject",
      hint: "x",
      segments: [{ start_s: 0, end_s: 1 }],
      ...(flag === undefined ? {} : { contributor_visible: flag }),
    };
    expect(isContributorVisible(reason)).toBe(false);
    const items = contributorFeedback({ reasons: [reason] });
    expect(items.map((i) => i.message)).toEqual([GENERIC_HIDDEN_MESSAGE]);
    expect(JSON.stringify(items)).not.toContain("abc");
  });

  it("handles decisions written before schema version 2", () => {
    const items = contributorFeedback({
      reasons: [
        { check: "technical", code: "technical.too_short", message: "Short.", effect: "reject" },
        { check: "hands_visible", code: "hands_visible.error", message: "Crash.", effect: "review" },
        { check: "technical", code: "pipeline.skipped_without_reject", message: "Skip.", effect: "review" },
      ],
    });
    expect(items).toEqual([{ check: "technical", code: "technical.too_short", effect: "reject", message: "Short.", hint: null, segments: [] }]);
  });

  it("drops hidden review-only reasons and tolerates missing decisions", () => {
    expect(contributorFeedback({ reasons: [{ check: "privacy", code: "privacy.faces", message: "Face.", effect: "review", contributor_visible: false }] })).toEqual([]);
    expect(contributorFeedback(null)).toEqual([]);
  });
});
