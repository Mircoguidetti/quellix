import { describe, expect, it } from "vitest";
import example from "@quellix/contracts/examples/rubric.load_dishwasher.json";
import { HANDS_CAN_REJECT, HANDS_UNCERTAIN_BAND, evaluate, outputsFromStoredChecks, type CheckName, type CheckOutput } from "./rubric-eval";

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

  it("sends hands below the minimum to review until the check is validated (#76)", () => {
    expect(HANDS_CAN_REJECT).toBe(false);
    const d = evaluate(rubric, { ...good(), hands_visible: { measurements: { ratio_both_manipulation: 0.55 } } });
    expect(d.decision).toBe("review");
    expect(d.reasons[0]).toMatchObject({ code: "hands_visible.below_min", effect: "review" });
    expect(d.reasons[0].message).toContain("55%");
    expect(d.reasons[0].message).toContain("80%");
    const m = d.checks.hands_visible.measurements;
    expect(m.reject_capped_to_review).toBe(true);
    expect(String(m.reject_cap_note)).toContain("#64");
    expect(m.ratio_both_manipulation).toBe(0.55);
    expect(d.checks.hands_visible.status).toBe("fail");
  });

  it("the cap only touches the hands check", () => {
    const d = evaluate(rubric, {
      ...good(),
      task_completed: { measurements: { completed: false, confidence: 0.9 } },
      hands_visible: { measurements: { ratio_both_manipulation: 0.55 } },
    });
    expect(d.decision).toBe("reject");
    expect(Object.fromEntries(d.reasons.map((r) => [r.code, r.effect]))).toEqual({
      "task_completed.not_completed": "reject",
      "hands_visible.below_min": "review",
    });
  });

  it("adds no cap note when hands pass or are not critical", () => {
    expect(evaluate(rubric, good()).checks.hands_visible.measurements.reject_capped_to_review).toBeUndefined();
    const r = structuredClone(rubric);
    r.checks.hands_visible = { ...r.checks.hands_visible, critical: false };
    const d = evaluate(r, { ...good(), hands_visible: { measurements: { ratio_both_manipulation: 0.55 } } });
    expect(d.decision).toBe("review");
    expect(d.checks.hands_visible.measurements.reject_capped_to_review).toBeUndefined();
  });

  it.each([0.6, 0.7, 0.79])("treats %s just under the minimum as uncertain and sends it to review", (ratio) => {
    expect(HANDS_UNCERTAIN_BAND).toBe(0.2);
    const d = evaluate(rubric, { ...good(), hands_visible: { measurements: { ratio_both_manipulation: ratio } } });
    expect(d.decision).toBe("review");
    expect(d.checks.hands_visible.status).toBe("uncertain");
    expect(d.reasons).toHaveLength(1);
    expect(d.reasons[0]).toMatchObject({ code: "hands_visible.near_min", effect: "review" });
    expect(d.reasons[0].message).toContain(`${Math.round(ratio * 100)}%`);
    expect(d.reasons[0].message).toContain("80%");
    expect(d.checks.hands_visible.measurements.reject_capped_to_review).toBeUndefined();
  });

  it.each([
    [0.59, "fail", "hands_visible.below_min"],
    [0.3, "fail", "hands_visible.below_min"],
    [0.8, "pass", null],
    [0.95, "pass", null],
  ])("hands band edge %s is %s", (ratio, status, code) => {
    const d = evaluate(rubric, { ...good(), hands_visible: { measurements: { ratio_both_manipulation: ratio } } });
    expect(d.checks.hands_visible.status).toBe(status);
    expect(d.reasons.map((r) => r.code)).toEqual(code ? [code] : []);
  });

  it("makes the band follow a custom min_ratio", () => {
    const r = structuredClone(rubric);
    r.checks.hands_visible = { ...r.checks.hands_visible, min_ratio: 0.5 };
    const at = (ratio: number) => evaluate(r, { ...good(), hands_visible: { measurements: { ratio_both_manipulation: ratio } } }).checks.hands_visible.status;
    expect(at(0.35)).toBe("uncertain");
    expect(at(0.25)).toBe("fail");
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
      originality: { measurements: { max_similarity: 0.98, match_video_id: "vid_0" } },
    });
    expect(d.reasons.map((r) => r.effect)).toEqual(["reject", "review", "review"]);
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
    // Hands cannot reject yet (#76), so a stricter hands minimum previews as review.
    expect(evaluate(strict, outputsFromStoredChecks(stored)).decision).toBe("review");
  });
});
