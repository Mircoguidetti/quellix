import { describe, expect, it } from "vitest";
import { ZodError } from "zod";
import { ApiError } from "@/lib/api/errors";
import {
  auditToCsv,
  computeAudit,
  csvCell,
  parseAuditQuery,
  resolveWindow,
  type AuditDecision,
  type AuditReview,
  type AuditVideo,
} from "./audit";

const R1 = "22222222-2222-4222-8222-222222222222";
const R2 = "44444444-4444-4444-8444-444444444444";
const WINDOW = { from: "2026-10-01", to: "2026-10-31" };

const video = (id: string, version = 1, rubric = R1): AuditVideo => ({
  id,
  external_id: `ext-${id}`,
  rubric_id: rubric,
  rubric_version: version,
  created_at: "2026-10-10T10:00:00Z",
});
const decision = (video_id: string, value: string, extra: Partial<AuditDecision> = {}): AuditDecision => ({
  video_id,
  decision: value,
  reasons: [],
  checks: {},
  created_at: "2026-10-10T10:01:00Z",
  ...extra,
});
const review = (video_id: string, value: string, extra: Partial<AuditReview> = {}): AuditReview => ({
  video_id,
  decision: value,
  note: null,
  created_at: "2026-10-11T09:00:00Z",
  ...extra,
});
const rubrics = [
  { id: R1, name: "Load the dishwasher" },
  { id: R2, name: "Fold laundry" },
];

describe("computeAudit", () => {
  const videos = [video("a"), video("b"), video("c"), video("d"), video("e"), video("f"), video("g", 2), video("h", 1, R2)];
  const decisions: AuditDecision[] = [
    // a: first rejected, then re-processed and accepted: only the latest counts.
    decision("a", "reject", { created_at: "2026-10-10T10:00:30Z", reasons: [{ check: "hands_visible", code: "hands_visible.below_min", effect: "reject" }] }),
    decision("a", "accept", { checks: { hands_visible: { status: "pass" }, technical: { status: "pass" } } }),
    decision("b", "reject", {
      reasons: [
        { check: "hands_visible", code: "hands_visible.below_min", effect: "reject" },
        { check: "hands_visible", code: "hands_visible.below_min", effect: "reject" },
        { check: "privacy", code: "privacy.faces", effect: "review" },
      ],
      checks: { hands_visible: { status: "fail" }, technical: { status: "pass" }, privacy: { status: "uncertain" } },
    }),
    decision("c", "review", {
      reasons: [{ check: "task_completed", code: "task_completed.uncertain", effect: "review" }],
      checks: { task_completed: { status: "uncertain" }, technical: { status: "skipped" } },
    }),
    decision("d", "review", { reasons: [{ check: "task_completed", code: "task_completed.uncertain", effect: "review" }] }),
    decision("e", "accept", { checks: { technical: { status: "error" } } }),
    // f: no decision yet.
    decision("g", "accept"),
    decision("h", "reject", { reasons: [{ check: "technical", code: "technical.too_short", effect: "reject" }] }),
  ];
  const reviews: AuditReview[] = [
    review("b", "accept", { note: "Hands are visible; the detector missed them." }), // override reject → accept
    review("c", "reject", { created_at: "2026-10-11T08:00:00Z" }),
    review("c", "accept"), // latest review on a review case: resolved accept
    review("e", "accept"), // spot check that agrees
  ];
  const report = computeAudit({ videos, decisions, reviews, rubrics, window: WINDOW, now: Date.parse("2026-11-01T00:00:00Z") });
  const v1 = report.groups.find((g) => g.rubric.id === R1 && g.rubric.version === 1)!;

  it("groups per rubric version, sorted by rubric name then newest version", () => {
    expect(report.groups.map((g) => `${g.rubric.name} v${g.rubric.version}`)).toEqual(["Fold laundry v1", "Load the dishwasher v2", "Load the dishwasher v1"]);
    expect(report.window).toEqual(WINDOW);
    expect(report.generated_at).toBe("2026-11-01T00:00:00.000Z");
  });

  it("counts each video once, with its latest decision", () => {
    expect(v1.videos).toEqual({ received: 6, decided: 5, not_decided: 1, accept: 2, reject: 1, review: 2 });
    expect(v1.automatic_rate).toBeCloseTo(3 / 5);
  });

  it("computes the pass rate per check without skipped results", () => {
    const technical = v1.checks.find((c) => c.check === "technical")!;
    expect(technical).toMatchObject({ pass: 2, fail: 0, uncertain: 0, error: 1, skipped: 1, evaluated: 3, label: "Technical quality" });
    expect(technical.pass_rate).toBeCloseTo(2 / 3);
    const hands = v1.checks.find((c) => c.check === "hands_visible")!;
    expect(hands.pass_rate).toBe(0.5);
    // Fixed order: task, hands, framing, technical, privacy, originality.
    expect(v1.checks.map((c) => c.check)).toEqual(["task_completed", "hands_visible", "technical", "privacy"]);
  });

  it("counts rejection codes once per video, from the latest decision only, and review codes apart", () => {
    expect(v1.rejection_codes).toEqual([{ code: "hands_visible.below_min", label: "Hands out of frame", count: 1 }]);
    expect(v1.review_codes).toEqual([{ code: "task_completed.uncertain", label: "Task unclear", count: 2 }]);
  });

  it("reports review routing, resolutions and the sampling rate of automatic decisions", () => {
    expect(v1.human_review).toEqual({
      routed_to_review: 2,
      routed_rate: 2 / 5,
      review_resolved_accept: 1,
      review_resolved_reject: 0,
      review_pending: 1,
      automatic_sampled: 2,
      sampling_rate: 2 / 3,
      reviewed_total: 3,
      reviewed_rate: 3 / 5,
    });
  });

  it("lists overrides of automatic decisions with the reviewer's note, not review resolutions", () => {
    expect(v1.overrides).toMatchObject({ total: 1, accept_to_reject: 0, reject_to_accept: 1, rate: 0.5 });
    expect(v1.overrides.items).toEqual([
      {
        video_id: "b",
        external_id: "ext-b",
        automatic: "reject",
        final: "accept",
        note: "Hands are visible; the detector missed them.",
        reviewed_at: "2026-10-11T09:00:00Z",
      },
    ]);
  });

  it("returns null rates rather than dividing by zero", () => {
    const empty = computeAudit({ videos: [video("x")], decisions: [], reviews: [], rubrics, window: WINDOW });
    expect(empty.groups[0].automatic_rate).toBeNull();
    expect(empty.groups[0].human_review.sampling_rate).toBeNull();
    expect(empty.groups[0].overrides.rate).toBeNull();
  });

  it("names a rubric that no longer exists", () => {
    const r = computeAudit({ videos: [video("x", 1, "gone")], decisions: [], reviews: [], rubrics, window: WINDOW });
    expect(r.groups[0].rubric.name).toBe("Deleted rubric");
  });

  it("exports one long CSV table", () => {
    const csv = auditToCsv(report);
    const lines = csv.trimEnd().split("\r\n");
    expect(lines[0]).toBe("rubric_id,rubric_name,rubric_version,section,key,metric,value");
    expect(lines).toContain(`${R1},Load the dishwasher,1,videos,,received,6`);
    expect(lines).toContain(`${R1},Load the dishwasher,1,check,technical,pass_rate,0.6667`);
    expect(lines).toContain(`${R1},Load the dishwasher,1,rejection_code,hands_visible.below_min,count,1`);
    expect(lines).toContain(`${R1},Load the dishwasher,1,human_review,,sampling_rate,0.6667`);
    expect(lines).toContain(`${R1},Load the dishwasher,1,override,ext-b,reject_to_accept,Hands are visible; the detector missed them.`);
    expect(csv.endsWith("\r\n")).toBe(true);
  });
});

describe("csvCell", () => {
  it("quotes separators, quotes and line breaks", () => {
    expect(csvCell('say "hi", then\nleave')).toBe('"say ""hi"", then\nleave"');
    expect(csvCell(null)).toBe("");
    expect(csvCell(3)).toBe("3");
  });

  it("defuses text a spreadsheet would run as a formula", () => {
    expect(csvCell("=HYPERLINK(\"x\")")).toBe("\"'=HYPERLINK(\"\"x\"\")\"");
    expect(csvCell("+1")).toBe("'+1");
    expect(csvCell("@cmd")).toBe("'@cmd");
    expect(csvCell(-1)).toBe("-1");
  });
});

describe("parseAuditQuery and resolveWindow", () => {
  const now = Date.parse("2026-10-22T15:00:00Z");

  it("defaults to the last 30 days, today included, as JSON", () => {
    const q = parseAuditQuery(new URLSearchParams());
    expect(q.format).toBe("json");
    expect(resolveWindow(q, now)).toEqual({ from: "2026-09-23", to: "2026-10-22" });
  });

  it("reads every filter and treats blanks as absent", () => {
    const q = parseAuditQuery(new URLSearchParams({ from: "2026-10-01", to: "2026-10-15", rubric_id: R1, version: "2", format: "csv" }));
    expect(q).toEqual({ from: "2026-10-01", to: "2026-10-15", rubric_id: R1, version: 2, format: "csv" });
    expect(parseAuditQuery({ rubric_id: "", version: "", from: ["2026-10-01"] })).toMatchObject({ from: "2026-10-01", rubric_id: undefined, version: undefined });
  });

  it("rejects bad input", () => {
    for (const bad of [{ from: "2026-02-30" }, { from: "yesterday" }, { version: "2" }, { rubric_id: "nope" }, { format: "xml" }, { rubric_id: R1, version: "0" }]) {
      expect(() => parseAuditQuery(bad), JSON.stringify(bad)).toThrow(ZodError);
    }
  });

  it("refuses a reversed or too long window", () => {
    expect(() => resolveWindow({ from: "2026-10-02", to: "2026-10-01" }, now)).toThrow(ApiError);
    expect(() => resolveWindow({ from: "2025-01-01", to: "2026-10-01" }, now)).toThrow(/366 days/);
    expect(resolveWindow({ from: "2026-10-01", to: "2026-10-01" }, now)).toEqual({ from: "2026-10-01", to: "2026-10-01" });
  });
});
