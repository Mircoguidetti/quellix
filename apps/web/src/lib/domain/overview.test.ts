import { describe, expect, it } from "vitest";
import { computeOverview, TREND_DAYS } from "./overview";

const NOW = Date.parse("2026-10-21T15:00:00Z");
const v = (id: string, at: string) => ({ id, created_at: at });
const d = (video_id: string, decision: string, at: string, codes: string[] = []) => ({
  video_id,
  decision,
  created_at: at,
  reasons: codes.map((code) => ({ code, effect: decision === "reject" ? "reject" : "review" })),
});

describe("computeOverview", () => {
  const videos = [
    v("a", "2026-10-21T08:00:00Z"),
    v("b", "2026-10-21T09:00:00Z"),
    v("c", "2026-10-21T10:00:00Z"),
    v("e", "2026-10-21T14:59:00Z"),
    v("y", "2026-10-20T12:00:00Z"),
    v("old", "2026-09-01T12:00:00Z"),
  ];
  const decisions = [
    d("a", "accept", "2026-10-21T08:01:00Z"),
    d("b", "reject", "2026-10-21T09:01:00Z", ["hands_visible.below_min"]),
    d("c", "review", "2026-10-21T10:01:00Z", ["privacy.faces"]),
    // A re-run: only the latest decision counts.
    d("c", "accept", "2026-10-21T08:30:00Z"),
    d("y", "reject", "2026-10-20T12:01:00Z", ["hands_visible.below_min", "technical.blurry"]),
  ];

  const o = computeOverview(videos, decisions, 7, NOW);

  it("counts today's videos and the share decided automatically", () => {
    expect(o.today).toMatchObject({ received: 4, decided: 3, auto: 2 });
    expect(o.today.autoRate).toBeCloseTo(2 / 3);
    expect(o.today.hoursSaved).toBeCloseTo((2 * 3) / 60);
    expect(o.yesterday).toEqual({ received: 1, autoRate: 1 });
    expect(o.waiting).toBe(7);
  });

  it("builds a 14-day trend ending today, ignoring older videos", () => {
    expect(o.trend).toHaveLength(TREND_DAYS);
    expect(o.trend.at(-1)).toMatchObject({ accept: 1, reject: 1, review: 1, pending: 1 });
    expect(o.trend.at(-2)).toMatchObject({ reject: 1 });
    expect(o.period.received).toBe(5);
  });

  it("ranks rejection reasons, counting each video once per reason", () => {
    expect(o.rejections[0]).toEqual({ code: "hands_visible.below_min", label: "Hands out of frame", count: 2 });
    expect(o.rejections.map((r) => r.code)).toContain("technical.blurry");
    expect(o.rejections.map((r) => r.code)).not.toContain("privacy.faces");
  });

  it("has no automatic rate on an empty day", () => {
    const empty = computeOverview([], [], 0, NOW);
    expect(empty.today.autoRate).toBeNull();
    expect(empty.rejections).toEqual([]);
  });
});
