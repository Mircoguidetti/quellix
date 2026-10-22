/**
 * Ready rubrics per task family, and a preset for requirements common to public egocentric data
 * specs (issue #28). Values are starting points the collector adjusts to the lab's own spec.
 * Requirements a rubric cannot express yet are listed in `unsupported` and shown next to the editor.
 */
import example from "@quellix/contracts/examples/rubric.load_dishwasher.json";

type Json = Record<string, unknown>;

export type SpecTemplate = {
  id: string;
  family: "kitchen" | "laundry" | "factory" | "common";
  title: string;
  summary: string;
  rubric: { name: string; task: Json; checks: Record<string, Json> };
  unsupported: string[];
};

const PRIVACY_REVIEW = { enabled: true, faces: "review", documents: "review", screens: "review" };

export const SPEC_LIBRARY: SpecTemplate[] = [
  {
    id: "kitchen-load-dishwasher",
    family: "kitchen",
    title: "Kitchen: load the dishwasher",
    summary: "Both hands in view during manipulation, 720p+, 20 s to 10 min, faces and screens to review.",
    rubric: { name: "Load the dishwasher", task: example.task as Json, checks: example.checks as Record<string, Json> },
    unsupported: [],
  },
  {
    id: "kitchen-prepare-food",
    family: "kitchen",
    title: "Kitchen: prepare a simple dish",
    summary: "Cutting and assembling food on a counter; hands in view 80% of manipulation, 30 s to 15 min.",
    rubric: {
      name: "Prepare a simple dish",
      task: {
        description: "Wash, cut and assemble the ingredients of a simple dish on the counter, then plate it.",
        steps: ["wash the ingredients", "cut them on a board", "assemble the dish", "plate it"],
        final_state: "the dish is plated and the knife is put down",
      },
      checks: {
        hands_visible: { enabled: true, critical: true, scope: "manipulation", require_both: true, min_ratio: 0.8 },
        technical: { enabled: true, critical: true, min_duration_s: 30, max_duration_s: 900, min_width: 1280, min_height: 720, min_fps: 24 },
        privacy: PRIVACY_REVIEW,
        originality: { enabled: true, on_duplicate: "reject" },
      },
    },
    unsupported: ["Knife safety and hygiene are not checked."],
  },
  {
    id: "laundry-fold",
    family: "laundry",
    title: "Laundry: fold clothes",
    summary: "Folding on a flat surface; both hands in view 85% of manipulation, 30 s to 10 min.",
    rubric: {
      name: "Fold laundry",
      task: {
        library_id: "fold_laundry",
        description: "Fold three shirts and a towel on a flat surface and stack them.",
        steps: ["lay the garment flat", "fold the sleeves in", "fold in half", "stack"],
        final_state: "a neat stack of folded clothes",
      },
      checks: {
        hands_visible: { enabled: true, critical: true, scope: "manipulation", require_both: true, min_ratio: 0.85 },
        technical: { enabled: true, critical: true, min_duration_s: 30, max_duration_s: 600, min_width: 1280, min_height: 720, min_fps: 24 },
        privacy: { enabled: true, faces: "review", documents: "ignore", screens: "review" },
        originality: { enabled: true, on_duplicate: "reject" },
      },
    },
    unsupported: [],
  },
  {
    id: "factory-assembly",
    family: "factory",
    title: "Factory: assemble a part",
    summary: "Bench assembly with tools; both hands in view 90% of manipulation, stable camera, 1080p.",
    rubric: {
      name: "Assemble a part at a workbench",
      task: {
        description: "Assemble the part from its components at the workbench, using the provided tools, and place it in the output tray.",
        steps: ["pick the components", "fit them together", "fasten with the tool", "place the part in the tray"],
        final_state: "the assembled part is in the output tray",
      },
      checks: {
        hands_visible: { enabled: true, critical: true, scope: "manipulation", require_both: true, min_ratio: 0.9 },
        framing: { enabled: true, critical: false, max_off_target_ratio: 0.1, max_unstable_ratio: 0.1 },
        technical: { enabled: true, critical: true, min_duration_s: 60, max_duration_s: 1800, min_width: 1920, min_height: 1080, min_fps: 30 },
        privacy: { enabled: true, faces: "review", documents: "review", screens: "reject" },
        originality: { enabled: true, on_duplicate: "reject" },
      },
    },
    unsupported: ["Gloves and protective equipment are not checked."],
  },
  {
    id: "common-public-spec",
    family: "common",
    title: "Common public egocentric spec",
    summary: "The requirements most public specs share: hands in frame ≥90%, ≥24 fps, at least 2 minutes, no resubmissions.",
    rubric: {
      name: "Common egocentric spec",
      task: { description: "Replace with the lab's task description." },
      checks: {
        hands_visible: { enabled: true, critical: true, scope: "manipulation", require_both: true, min_ratio: 0.9 },
        technical: { enabled: true, critical: true, min_duration_s: 120, min_fps: 24 },
        privacy: PRIVACY_REVIEW,
        originality: { enabled: true, on_duplicate: "reject" },
      },
    },
    unsupported: ["Landscape orientation is not checked yet.", "Idle time (e.g. no pause longer than 3 s) is not measured yet.", "Staged or unnatural recording is not detected yet."],
  },
];

export function findTemplate(id: string | undefined | null): SpecTemplate | undefined {
  return SPEC_LIBRARY.find((t) => t.id === id);
}
