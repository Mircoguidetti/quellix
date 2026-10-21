import { describe, expect, it } from "vitest";
import { formatMeasurement, measurementLabel } from "./measurements";

describe("measurements", () => {
  it("formats ratios, times and detections", () => {
    expect(formatMeasurement("ratio_both_manipulation", 0.614)).toBe("61%");
    expect(formatMeasurement("end_s", 31)).toBe("00:31");
    expect(formatMeasurement("faces", [{ t_s: 12.4 }, { t_s: 40 }])).toBe("2 at 00:12, 00:40");
    expect(formatMeasurement("faces", [])).toBe("none");
    expect(formatMeasurement("manipulation_segments", [[4, 18]])).toBe("00:04–00:18");
    expect(formatMeasurement("completed", true)).toBe("yes");
    expect(formatMeasurement("match_video_id", null)).toBe("—");
  });

  it("labels known keys and humanises unknown ones", () => {
    expect(measurementLabel("blur_ratio")).toBe("Blurry frames");
    expect(measurementLabel("new_thing")).toBe("new thing");
  });
});
