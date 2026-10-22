/**
 * Which real clips (issue #60, files in public/media/clips) the marketing pages show. Leave an
 * entry null to keep the drawn placeholder. Each id is a clip's sidecar name, without ".json"; its
 * poster is expected at <id>.jpg (the hero renders it before the sidecar loads).
 */
export const SITE_CLIPS: {
  hero: string | null;
  /** The "Why Ormes" split scene on Home: a clip whose real decision is a reject with a hint. */
  why: string | null;
  /** One clip per example video in the Product decision diagram. */
  decision: { reject: string | null; review: string | null; accept: string | null };
} = {
  hero: "clip-02",
  why: null,
  decision: { reject: null, review: null, accept: null },
};
