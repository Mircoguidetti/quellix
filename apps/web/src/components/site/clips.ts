/**
 * Which real clips (public/media/clips, from PR #75) the marketing pages show. Each id is a clip's
 * sidecar name without ".json"; its poster is at <id>.jpg. Every clip is first-person Pexels footage
 * analysed by the worker; the pages show its sidecar output as it is, never edited.
 */
export const SITE_CLIPS = {
  /** Home hero: the full 16:9 clip at every width (the 4:5 crop cuts the hands, so it is not used). */
  hero: "clip-01",
  /** Home "Why Ormes": the same task three ways, so all three outcomes appear. */
  why: { accept: "clip-01", review: "clip-01-hand", reject: "clip-01-dark" },
  /** Product decision diagram: the videos it plays through the checks, in order. */
  decision: ["clip-02", "clip-03", "clip-04", "clip-01-dark"],
} as const;
