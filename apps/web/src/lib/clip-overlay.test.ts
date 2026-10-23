import { describe, expect, it } from "vitest";
import { boxRect, frameAt, groupClips, sourcesLabel, splitVariants, stepAt, type FrameRow, type ManifestClip } from "./clip-overlay";

const row = (t: number): FrameRow => ({
  t,
  left: { state: "full", box: [0.1, 0.2, 0.3, 0.4], contact: "object" },
  right: { state: "absent", box: null, contact: "unknown" },
});

describe("frameAt", () => {
  const frames = [0, 0.125, 0.25, 0.375, 0.5].map(row);

  it("returns the nearest sampled frame", () => {
    expect(frameAt(frames, 0)?.t).toBe(0);
    expect(frameAt(frames, 0.06)?.t).toBe(0);
    expect(frameAt(frames, 0.07)?.t).toBe(0.125);
    expect(frameAt(frames, 0.3)?.t).toBe(0.25);
    expect(frameAt(frames, 9)?.t).toBe(0.5);
    expect(frameAt(frames, -3)?.t).toBe(0);
  });

  it("is null without frames and works with one frame", () => {
    expect(frameAt([], 1)).toBeNull();
    expect(frameAt([row(2)], 0)?.t).toBe(2);
  });
});

describe("boxRect", () => {
  it("scales a normalized box to pixels", () => {
    expect(boxRect([0.25, 0.5, 0.75, 1], 400, 200)).toEqual({ x: 100, y: 100, w: 200, h: 100 });
  });

  it("clamps boxes that leave the frame, as detectors extrapolate past the edge", () => {
    expect(boxRect([-0.2, 0.5, 1.4, 1.2], 100, 100)).toEqual({ x: 0, y: 50, w: 100, h: 50 });
  });
});

describe("stepAt", () => {
  const steps = [
    { name: "pick", t_s: 1 },
    { name: "place", t_s: 4 },
  ];

  it("gives the step that started last", () => {
    expect(stepAt(steps, 0.5)).toBeNull();
    expect(stepAt(steps, 2)?.name).toBe("pick");
    expect(stepAt(steps, 4)?.name).toBe("place");
    expect(stepAt([], 3)).toBeNull();
  });
});

describe("stepAt with ends and labels", () => {
  const steps = [
    { name: "grab lens", t_s: 0, end_s: 2, source: "task annotation" },
    { name: "turn dial", t_s: 5, end_s: 9 },
  ];

  it("hides a step once it has ended", () => {
    expect(stepAt(steps, 1)?.name).toBe("grab lens");
    expect(stepAt(steps, 3)).toBeNull();
    expect(stepAt(steps, 6)?.name).toBe("turn dial");
    expect(stepAt(steps, 9.5)).toBeNull();
  });
});

describe("sourcesLabel", () => {
  it("joins datasets with their licenses", () => {
    expect(sourcesLabel([{ dataset: "Pexels", license: "Pexels License" }, { dataset: "Own capture", license: "CC BY 4.0" }])).toBe(
      "Pexels (Pexels License) and Own capture (CC BY 4.0)",
    );
    expect(sourcesLabel([])).toBe("");
  });
});

describe("groupClips", () => {
  const clip = (id: string, variant_of?: string): ManifestClip => ({
    id,
    source_clip: id,
    factory: "",
    dataset: "Pexels",
    license: "Pexels License",
    task: "Folding laundry",
    decision: "accept",
    mp4: `${id}.mp4`,
    webm: `${id}.webm`,
    poster: `${id}.jpg`,
    bytes: {},
    variant_of,
  });

  it("puts each defective copy under the clean clip it was made from, keeping manifest order", () => {
    const groups = groupClips([clip("clip-01"), clip("clip-01-hand", "clip-01"), clip("clip-01-dark", "clip-01"), clip("clip-02")]);
    expect(groups.map((g) => g.clip.id)).toEqual(["clip-01", "clip-02"]);
    expect(groups[0].variants.map((v) => v.id)).toEqual(["clip-01-hand", "clip-01-dark"]);
    expect(groups[1].variants).toEqual([]);
  });

  it("separates the mobile crop from the synthetic defects", () => {
    const m = { ...clip("clip-01-mobile", "clip-01"), variant_kind: "mobile_crop" as const };
    const h = { ...clip("clip-01-hand", "clip-01"), variant_kind: "hand" as const };
    const { mobile, defects } = splitVariants([m, h]);
    expect(mobile.map((c) => c.id)).toEqual(["clip-01-mobile"]);
    expect(defects.map((c) => c.id)).toEqual(["clip-01-hand"]);
  });
});
