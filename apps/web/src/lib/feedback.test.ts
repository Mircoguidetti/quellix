import { describe, expect, it } from "vitest";
import decision from "@quellix/contracts/examples/decision.feedback.json";
import expected from "@quellix/contracts/examples/decision.feedback.expected.json";
import { GENERIC_HIDDEN_MESSAGE, contestFeedback, contributorFeedback, formatSegments, isContributorVisible } from "./feedback";

describe("contributor feedback (issue #22)", () => {
  it("matches the shared vectors from the contract", () => {
    expect(contributorFeedback(decision.reasons)).toEqual(expected);
  });

  it.each([true, false, undefined])("never shows a duplicate (contributor_visible=%s)", (flag) => {
    const reason = {
      check: "originality",
      code: "originality.duplicate",
      message: "This video was already delivered (matches video vid_secret); similarity 0.97.",
      effect: "reject",
      hint: "x",
      ...(flag === undefined ? {} : { contributor_visible: flag }),
    };
    expect(isContributorVisible(reason)).toBe(false);
    const items = contestFeedback([reason]);
    expect(items.map((i) => i.message)).toEqual([GENERIC_HIDDEN_MESSAGE]);
    expect(JSON.stringify(items)).not.toContain("vid_secret");
  });

  it("the contest page keeps only rejection feedback, in time order", () => {
    expect(contestFeedback(decision.reasons).map((i) => i.code)).toEqual(["hands_visible.below_min", "technical.blurry", null]);
  });

  it("is safe on malformed input", () => {
    expect(contributorFeedback(null)).toEqual([]);
    expect(contributorFeedback([null, 3, { effect: "reject" }, { effect: "reject", message: 3 }])).toEqual([]);
    expect(contributorFeedback([{ check: "technical", code: "technical.blurry", message: "Blurry.", effect: "reject", segments: [{ start_s: "a" }] }])[0].segments).toEqual([]);
  });
});

describe("formatSegments", () => {
  it("formats ranges and instants like the worker's messages", () => {
    expect(formatSegments([{ start_s: 12, end_s: 18.5 }, { start_s: 5.2, end_s: 5.4 }])).toBe("00:12–00:18, 00:05");
  });
});
