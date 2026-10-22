import { describe, expect, it } from "vitest";
import { boxRect, frameAt, stepAt, type FrameRow } from "./clip-overlay";

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
