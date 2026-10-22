import { describe, expect, it } from "vitest";
import { assemble } from "./assemble";
import { KITCHEN_SPEC } from "./fixtures";
import { extractWithRules } from "./rules";
import { normalizeSource, toLines } from "./source";

const lines = toLines(normalizeSource(KITCHEN_SPEC));
const lineOf = (needle: string) => lines.find((l) => l.text.includes(needle))!.n;
const { fields, unsupported } = extractWithRules(lines);
const draft = assemble(lines, fields, unsupported, [], false);
const field = (path: string) => draft.fields.find((f) => f.path === path);

describe("local spec extractor (issue #28)", () => {
  it("drafts a schema-valid rubric from the guideline", () => {
    expect(draft.warnings).toEqual([]);
    expect(draft.name).toBe("Egocentric Kitchen Data: Recording Guidelines v3");
    expect(draft.rubric.task).toEqual({
      description: "Load dirty dishes into the dishwasher and close the door.",
      steps: ["Open the dishwasher door", "Place plates and glasses in the racks", "Close the door"],
      final_state: "the dishwasher door is closed with all items inside",
    });
    expect(draft.rubric.checks).toEqual({
      hands_visible: { require_both: true, scope: "manipulation", min_ratio: 0.9 },
      technical: { min_duration_s: 120, max_duration_s: 600, min_width: 1920, min_height: 1080, min_fps: 30, max_blur_ratio: 0.05 },
      privacy: { faces: "reject", documents: "review", screens: "reject" },
      originality: { on_duplicate: "reject" },
    });
  });

  it("cites every value to its line and the words it came from", () => {
    expect(field("checks.hands_visible.min_ratio")).toMatchObject({ line: lineOf("Both hands"), source: "rules" });
    expect(field("checks.hands_visible.min_ratio")!.quote).toContain("90%");
    expect(field("checks.technical.min_fps")).toMatchObject({ line: lineOf("30 fps"), value: 30 });
    expect(field("checks.technical.min_duration_s")!.quote).toContain("at least 2 minutes");
    expect(field("task.steps")!.line).toBe(lineOf("1. Open"));
    for (const f of draft.fields) {
      expect(f.line).toBeGreaterThan(0);
      expect(lines[f.line - 1].text.toLowerCase()).toContain(f.quote.toLowerCase().slice(0, 12));
    }
  });

  it("lists what the rubric cannot check instead of dropping it", () => {
    const notes = draft.unsupported.map((u) => [u.line, u.note]);
    expect(notes).toContainEqual([lineOf("landscape"), "Orientation is not checked yet."]);
    expect(notes).toContainEqual([lineOf("landscape"), "Camera placement is not checked."]);
    expect(notes).toContainEqual([lineOf("idle"), "Idle time is not measured yet."]);
    expect(notes).toContainEqual([lineOf("stage"), "Staged or unnatural recording is not detected yet."]);
    expect(notes).toContainEqual([lineOf("Audio"), "Audio is not checked."]);
    // "no idle time longer than 3 seconds" is not a video duration
    expect(draft.rubric.checks.technical.max_duration_s).toBe(600);
  });

  it("handles other phrasings", () => {
    const l = toLines("Video length between 30 and 90 seconds\nAt least one hand in view throughout\n720p minimum, 24fps\nHands visible 80% of the entire video");
    const r = assemble(l, extractWithRules(l).fields, [], [], false);
    expect(r.rubric.checks.technical).toEqual({ min_duration_s: 30, max_duration_s: 90, min_width: 1280, min_height: 720, min_fps: 24 });
    expect(r.rubric.checks.hands_visible.require_both).toBe(false);
    // two lines disagree on min_ratio: the first wins and the conflict is reported
    expect(r.rubric.checks.hands_visible.min_ratio).toBe(1);
    expect(r.warnings.join(" ")).toContain("checks.hands_visible.min_ratio: line 2 gives 1, line 4 gives 0.8");
  });

  it("sets nothing it cannot cite", () => {
    const l = toLines("Please record carefully.");
    const r = assemble(l, extractWithRules(l).fields, [], [], false);
    expect(r.rubric.checks).toEqual({});
    expect(r.fields).toEqual([{ path: "task.description", value: "Please record carefully", line: 1, quote: "Please record carefully.", source: "rules" }]);
  });
});
