/** The source text as numbered lines: the unit every citation points to. */

export const MAX_SOURCE_CHARS = 60_000;

export type SourceLine = { n: number; text: string };

export function normalizeSource(raw: string): string {
  return raw
    .replace(/\r\n?/g, "\n")
    .replace(/ /g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, MAX_SOURCE_CHARS);
}

export function toLines(text: string): SourceLine[] {
  return text.split("\n").map((t, i) => ({ n: i + 1, text: t.trim() }));
}

const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9%]+/g, " ").trim();

/** True when `quote` really appears on line `n` (or spans into the next one), ignoring case and punctuation. */
export function quoteOnLine(lines: SourceLine[], n: number, quote: string): boolean {
  const q = squash(quote);
  if (q.length < 3) return false;
  const here = lines[n - 1]?.text ?? "";
  const next = lines[n]?.text ?? "";
  return squash(here).includes(q) || squash(`${here} ${next}`).includes(q);
}
