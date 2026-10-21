import { describe, expect, it } from "vitest";
import { flaggedMoments, momentClock, videoDuration } from "./timeline";

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

describe("video duration", () => {
  it("falls back to the technical duration", () => {
    expect(videoDuration(null, checks)).toBe(34);
    expect(videoDuration(20, checks)).toBe(20);
    expect(videoDuration(null, {})).toBeNull();
  });
});


describe("flagged moments", () => {
  it("lists every detection with its measurement, in time order, then whole-video reasons", () => {
    const moments = flaggedMoments(reasons, checks, 34);
    expect(moments.map((m) => [m.code, m.t])).toEqual([
      ["hands_visible.below_min", 4.2],
      ["privacy.faces", 12.4],
      ["privacy.faces", 34],
      ["framing.off_target", null],
    ]);
    expect(moments[0].detail).toBe("Visible 61% while handling objects · 00:04–00:18, 00:20–00:30");
    expect(moments[1].detail).toBe("Detection 1 of 2");
    expect(moments[3].detail).toBe("Off target 30% of frames");
  });

  it("explains the task moment with confidence and the task window", () => {
    const [m] = flaggedMoments(
      [{ check: "task_completed", code: "task_completed.uncertain", message: "Could not tell", effect: "review" }],
      { task_completed: { measurements: { completed: true, confidence: 0.54, start_s: 3, end_s: 31 } } },
      40,
    );
    expect(m).toMatchObject({ t: 31, detail: "Completed yes · confidence 54% · task 00:03–00:31" });
  });
});

describe("moment times", () => {
  it("round like the worker's messages", () => {
    expect(momentClock(28.6)).toBe("00:29");
    expect(momentClock(12.4)).toBe("00:12");
  });
});
