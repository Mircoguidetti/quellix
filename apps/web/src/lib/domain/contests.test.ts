import { describe, expect, it } from "vitest";
import { createFakeDb } from "@/test/fake-supabase";
import { contributorReasons, getContestInfo } from "./contests";

const VIDEO = "11111111-1111-4111-8111-111111111111";
const reasons = [
  { check: "hands_visible", code: "hands_visible.below_min", message: "Both hands visible 61% of the time.", effect: "reject" },
  { check: "privacy", code: "privacy.error", message: "The privacy check failed: detector unavailable.", effect: "review" },
];

describe("contributor-facing reasons (issue #8)", () => {
  it("keeps only the reasons that caused the rejection", () => {
    expect(contributorReasons(reasons)).toEqual(["Both hands visible 61% of the time."]);
  });

  it("is safe on malformed input", () => {
    expect(contributorReasons(null)).toEqual([]);
    expect(contributorReasons([{ effect: "reject" }, null, { effect: "reject", message: 3 }])).toEqual([]);
  });

  it("the contest page never shows review-only reasons", async () => {
    const { db } = createFakeDb((c) => {
      if (c.table === "videos") return { data: { id: VIDEO, org_id: "org", contributor_ref: "c_1" }, error: null };
      if (c.table === "decisions") return { data: { decision: "reject", reasons }, error: null };
      if (c.table === "reviews") return { data: null, error: null };
      return undefined;
    });
    const info = await getContestInfo(db, VIDEO);
    expect(info?.reasons).toEqual(["Both hands visible 61% of the time."]);
  });

  it("offers nothing to contest when the video was not rejected", async () => {
    const { db } = createFakeDb((c) => {
      if (c.table === "videos") return { data: { id: VIDEO, org_id: "org", contributor_ref: null }, error: null };
      if (c.table === "decisions") return { data: { decision: "review", reasons }, error: null };
      return { data: null, error: null };
    });
    expect(await getContestInfo(db, VIDEO)).toBeNull();
  });
});
