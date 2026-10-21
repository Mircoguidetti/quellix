import { describe, expect, it } from "vitest";
import example from "@quellix/contracts/examples/rubric.load_dishwasher.json";
import { evaluate, outputsFromStoredChecks, type CheckName, type CheckOutput } from "./rubric-eval";

// Mirrors services/worker/tests/test_rubric.py so the preview and the worker agree.
type Outputs = Partial<Record<CheckName, CheckOutput>>;
const good = (): Outputs => ({
  task_completed: { measurements: { completed: true, confidence: 0.93, start_s: 3.2, end_s: 31.0 } },
  hands_visible: { measurements: { ratio_both_manipulation: 0.92, ratio_any_manipulation: 0.99, ratio_both_whole: 0.85, ratio_any_whole: 0.95 } },
  framing: { measurements: { off_target_ratio: 0.02, unstable_ratio: 0.03 } },
  technical: { measurements: { decodable: true, duration_s: 34, width: 1920, height: 1080, fps: 30, blur_ratio: 0.01, bad_exposure_ratio: 0 } },
  privacy: { measurements: { faces: [], documents: [], screens: [] } },
  originality: { measurements: { max_similarity: 0.12, match_video_id: null } },
});
const rubric = structuredClone(example) as { checks: Record<string, Record<string, unknown>> };

describe("rubric evaluation (port of the worker)", () => {
  it("accepts a clean video", () => {
    const d = evaluate(rubric, good());
    expect(d.decision).toBe("accept");
    expect(d.reasons).toEqual([]);
    expect(Object.values(d.checks).every((c) => c.status === "pass")).toBe(true);
  });

  it("rejects hands below the minimum with a readable reason", () => {
    const d = evaluate(rubric, { ...good(), hands_visible: { measurements: { ratio_both_manipulation: 0.61 } } });
    expect(d.decision).toBe("reject");
    expect(d.reasons[0].code).toBe("hands_visible.below_min");
    expect(d.reasons[0].message).toContain("61%");
    expect(d.reasons[0].message).toContain("80%");
  });

  it("sends low task confidence to review, not reject", () => {
    const d = evaluate(rubric, { ...good(), task_completed: { measurements: { completed: false, confidence: 0.4 } } });
    expect(d.decision).toBe("review");
    expect(d.checks.task_completed.status).toBe("uncertain");
  });

  it("sends a face to review with its timestamp", () => {
    const d = evaluate(rubric, { ...good(), privacy: { measurements: { faces: [{ t_s: 12.4 }], documents: [], screens: [] } } });
    expect(d.decision).toBe("review");
    expect(d.reasons[0].message).toContain("00:12");
  });

  it("rejects a duplicate", () => {
    const d = evaluate(rubric, { ...good(), originality: { measurements: { max_similarity: 0.98, match_video_id: "vid_0" } } });
    expect(d.decision).toBe("reject");
    expect(d.reasons[0].message).toContain("vid_0");
  });

  it("never silently accepts a missing check", () => {
    const outputs = good();
    delete outputs.hands_visible;
    const d = evaluate(rubric, outputs);
    expect(d.decision).toBe("review");
    expect(d.checks.hands_visible.status).toBe("error");
  });

  it("skips a disabled check", () => {
    const r = structuredClone(rubric);
    r.checks.framing = { enabled: false };
    const d = evaluate(r, { ...good(), framing: { measurements: { off_target_ratio: 0.9, unstable_ratio: 0.9 } } });
    expect(d.decision).toBe("accept");
    expect(d.checks.framing.status).toBe("skipped");
  });

  it("lists reject reasons before review reasons", () => {
    const d = evaluate(rubric, {
      ...good(),
      framing: { measurements: { off_target_ratio: 0.3, unstable_ratio: 0 } },
      hands_visible: { measurements: { ratio_both_manipulation: 0.5 } },
    });
    expect(d.reasons.map((r) => r.effect)).toEqual(["reject", "review"]);
  });

  it("sends a skip without any reject to review", () => {
    const d = evaluate(rubric, { ...good(), task_completed: { skipped: "should not happen" } });
    expect(d.decision).toBe("review");
    expect(d.reasons[0].code).toBe("pipeline.skipped_without_reject");
  });

  it("re-applies a stricter rubric to stored checks", () => {
    const stored = evaluate(rubric, good()).checks;
    const strict = structuredClone(rubric);
    strict.checks.hands_visible = { ...strict.checks.hands_visible, min_ratio: 0.95 };
    expect(evaluate(strict, outputsFromStoredChecks(stored)).decision).toBe("reject");
  });
});
