/**
 * Which real clips (issue #60, files in public/media/clips) the marketing pages show. Leave an
 * entry null to keep the drawn placeholder. Each id is a clip's sidecar name, without ".json"; its
 * poster is expected at <id>.jpg (the hero renders posters before the sidecars load).
 */
export const SITE_CLIPS: {
  /** Home hero: a landscape clip from 640 px up, a portrait (9:16) clip below. */
  hero: { landscape: string | null; portrait: string | null };
  /** The "Why Ormes" split scene on Home: a clip whose real decision is a reject with a hint. */
  why: string | null;
  /** One clip per example video in the Product decision diagram. */
  decision: { reject: string | null; review: string | null; accept: string | null };
} = {
  // The landing uses domestic Pexels footage (founder, #60): shirts (landscape) and cups (portrait)
  // once that PR is merged. Factory footage stays for eval only.
  hero: { landscape: null, portrait: null },
  why: null,
  decision: { reject: null, review: null, accept: null },
};
