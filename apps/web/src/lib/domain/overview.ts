import type { SupabaseClient } from "@supabase/supabase-js";
import { errors } from "@/lib/api/errors";
import { reasonLabel } from "@/lib/format";
import { countReviewQueue } from "./videos";

const DAY = 24 * 60 * 60 * 1000;
export const TREND_DAYS = 14;
/** Same assumption as the landing's example: a person spends 3 minutes reviewing a video. */
export const REVIEW_MINUTES_PER_VIDEO = 3;

type VideoIn = { id: string; created_at: string };
type DecisionIn = { video_id: string; decision: string; reasons: unknown; created_at: string };

export type TrendDay = { day: string; accept: number; reject: number; review: number; pending: number };
export type ReasonCount = { code: string; label: string; count: number };
export type Overview = {
  /** When these numbers were computed (ms since epoch). */
  asOf: number;
  today: { received: number; decided: number; auto: number; autoRate: number | null; hoursSaved: number };
  yesterday: { received: number; autoRate: number | null };
  waiting: number;
  trend: TrendDay[];
  rejections: ReasonCount[];
  period: { received: number; decided: number; autoRate: number | null; hoursSaved: number };
};

export function startOfDayUTC(t: number): number {
  const d = new Date(t);
  d.setUTCHours(0, 0, 0, 0);
  return d.getTime();
}

/**
 * Today's numbers and the 14-day trend. Videos are counted on the day they were received; a
 * video is "decided automatically" when its latest decision is accept or reject.
 */
export function computeOverview(videos: VideoIn[], decisions: DecisionIn[], waiting: number, now = Date.now()): Overview {
  const latest = new Map<string, DecisionIn>();
  for (const d of [...decisions].sort((a, b) => b.created_at.localeCompare(a.created_at))) {
    if (!latest.has(d.video_id)) latest.set(d.video_id, d);
  }
  const today = startOfDayUTC(now);
  const first = today - (TREND_DAYS - 1) * DAY;
  const trend: TrendDay[] = Array.from({ length: TREND_DAYS }, (_, i) => ({
    day: new Date(first + i * DAY).toISOString(),
    accept: 0,
    reject: 0,
    review: 0,
    pending: 0,
  }));
  const reasons = new Map<string, number>();
  const bucket = (from: number, to: number) => {
    let received = 0;
    let decided = 0;
    let auto = 0;
    for (const v of videos) {
      const t = Date.parse(v.created_at);
      if (t < from || t >= to) continue;
      received++;
      const d = latest.get(v.id);
      if (!d) continue;
      decided++;
      if (d.decision !== "review") auto++;
    }
    return { received, decided, auto, autoRate: decided ? auto / decided : null };
  };

  for (const v of videos) {
    const t = Date.parse(v.created_at);
    if (t < first) continue;
    const slot = trend[Math.floor((t - first) / DAY)];
    if (!slot) continue;
    const d = latest.get(v.id);
    if (!d) slot.pending++;
    else if (d.decision === "accept" || d.decision === "reject" || d.decision === "review") slot[d.decision]++;
    if (d?.decision === "reject") {
      const codes = new Set(
        ((d.reasons ?? []) as { code?: string; effect?: string }[]).filter((r) => r.effect === "reject" && r.code).map((r) => r.code as string),
      );
      for (const code of codes) reasons.set(code, (reasons.get(code) ?? 0) + 1);
    }
  }

  const t = bucket(today, today + DAY);
  const y = bucket(today - DAY, today);
  const p = bucket(first, today + DAY);
  const hours = (auto: number) => (auto * REVIEW_MINUTES_PER_VIDEO) / 60;
  return {
    asOf: now,
    today: { ...t, hoursSaved: hours(t.auto) },
    yesterday: { received: y.received, autoRate: y.autoRate },
    waiting,
    trend,
    rejections: [...reasons.entries()]
      .map(([code, count]) => ({ code, label: reasonLabel(code), count }))
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
      .slice(0, 6),
    period: { received: p.received, decided: p.decided, autoRate: p.autoRate, hoursSaved: hours(p.auto) },
  };
}

export async function loadOverview(db: SupabaseClient, orgId: string, now = Date.now()): Promise<Overview> {
  const since = new Date(startOfDayUTC(now) - (TREND_DAYS - 1) * DAY).toISOString();
  const [videos, decisions, waiting] = await Promise.all([
    db.from("videos").select("id, created_at").eq("org_id", orgId).gte("created_at", since).limit(20000),
    db.from("decisions").select("video_id, decision, reasons, created_at").eq("org_id", orgId).gte("created_at", since).limit(20000),
    countReviewQueue(db, orgId),
  ]);
  if (videos.error || decisions.error) throw errors.internal();
  return computeOverview((videos.data ?? []) as VideoIn[], (decisions.data ?? []) as DecisionIn[], waiting, now);
}
