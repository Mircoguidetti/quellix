import { describe, expect, it } from "vitest";
import { reasonMarkers, videoDuration } from "./timeline";

const reasons = [
  { check: "hands_visible", code: "hands_visible.below_min", message: "Both hands visible 61%", effect: "reject" },
  { check: "privacy", code: "privacy.faces", message: "A face is visible at 00:12.", effect: "review" },
  { check: "framing", code: "framing.off_target", message: "Camera pointed away", effect: "review" },
];
const checks = {
  hands_visible: { measurements: { ratio_both_manipulation: 0.61, manipulation_segments: [[4.2, 18], [20, 30]] } },
  privacy: { measurements: { faces: [{ t_s: 12.4 }, { t_s: 40 }], documents: [], screens: [] } },
  framing: { measurements: { off_target_ratio: 0.3 } },
  technical: { measurements: { duration_s: 34 } },
};

describe("reason markers", () => {
  it("pins reasons to the timestamps found in their measurements, sorted by time", () => {
    const markers = reasonMarkers(reasons, checks, 34);
    expect(markers.map((m) => [m.code, m.t])).toEqual([
      ["hands_visible.below_min", 4.2],
      ["privacy.faces", 12.4],
    ]);
    expect(markers[0]).toMatchObject({ end: 18, effect: "reject", label: "Hands out of frame", reasonIndex: 0 });
    expect(markers[1]).toMatchObject({ effect: "review", reasonIndex: 1 });
  });

  it("skips reasons without a moment in time and clamps to the duration", () => {
    const markers = reasonMarkers(
      [{ check: "privacy", code: "privacy.documents", message: "x", effect: "review" }],
      { privacy: { measurements: { documents: [{ t_s: 99 }] } } },
      30,
    );
    expect(markers[0].t).toBe(30);
    expect(reasonMarkers([reasons[2]], checks, 34)).toEqual([]);
  });

  it("falls back to the technical duration", () => {
    expect(videoDuration(null, checks)).toBe(34);
    expect(videoDuration(20, checks)).toBe(20);
    expect(videoDuration(null, {})).toBeNull();
  });
});
