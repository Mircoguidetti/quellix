// Naive in-memory limiter: per server instance, resets on restart. Good enough to blunt abuse of
// the public contest form in v1; replace with a shared store if it ever matters.
const hits = new Map<string, number[]>();

export function rateLimited(key: string, max = 5, windowMs = 60 * 60 * 1000, now = Date.now()): boolean {
  const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
  if (recent.length >= max) {
    hits.set(key, recent);
    return true;
  }
  recent.push(now);
  hits.set(key, recent);
  if (hits.size > 5000) for (const [k, v] of hits) if (!v.some((t) => now - t < windowMs)) hits.delete(k);
  return false;
}
