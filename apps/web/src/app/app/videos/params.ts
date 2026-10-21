import { z } from "zod";
import { decisionValueSchema, videoStatusSchema } from "@/lib/api/schemas";

export const RANGES = { today: "Today", "7d": "Last 7 days", "30d": "Last 30 days", "90d": "Last 90 days" } as const;
export type Range = keyof typeof RANGES;

const first = (v: unknown) => (Array.isArray(v) ? v[0] : v);
const opt = <T extends z.ZodTypeAny>(s: T) => z.preprocess((v) => first(v) || undefined, s.optional().catch(undefined));

export const videosQuerySchema = z.object({
  decision: opt(decisionValueSchema),
  status: opt(videoStatusSchema),
  rubric: opt(z.string().uuid()),
  range: opt(z.enum(["today", "7d", "30d", "90d"])),
  q: opt(z.string().trim().max(200)),
  cursor: opt(z.string().max(200)),
  // Cursors of the pages before this one, so "Previous" works with keyset pagination.
  prev: opt(z.string().max(4000)),
});

export type VideosQuery = z.infer<typeof videosQuerySchema>;

export function rangeStart(range: Range | undefined, now = Date.now()): string | undefined {
  if (!range) return undefined;
  const d = new Date(now);
  d.setUTCHours(0, 0, 0, 0);
  const days = { today: 0, "7d": 6, "30d": 29, "90d": 89 }[range];
  return new Date(d.getTime() - days * 86_400_000).toISOString();
}
