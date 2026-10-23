"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { CLIP_BASE, ClipPlayer, useClip } from "../clip-player";
import { SITE_CLIPS } from "../clips";

// A dark backing keeps the chip readable over bright footage.
const TONE = { accept: "bg-black/65 text-ok", review: "bg-black/65 text-brand", reject: "bg-black/65 text-no" } as const;

/**
 * The hero's clip card (issue #85): the same 16:9 clip at every width, rounded at the top, no bottom
 * border, its bottom fading into the hero. The poster is in the server HTML (it is the LCP); the clip
 * starts after the page has loaded. The only overlays are the worker's decision and the hand boxes
 * (drawn by ClipPlayer from the sidecar, synced to the video and mapped through object-cover).
 */
export function HeroScreen() {
  const id = SITE_CLIPS.hero;
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let timer = 0;
    const go = () => (timer = window.setTimeout(() => setLoaded(true), 300));
    if (document.readyState === "complete") go();
    else window.addEventListener("load", go, { once: true });
    return () => {
      window.removeEventListener("load", go);
      clearTimeout(timer);
    };
  }, []);

  const clip = useClip(loaded ? id : null);
  const side = clip && clip !== "missing" ? clip : null;
  const verdict = side?.decision?.decision ?? null;

  return (
    // The visible part of the card is as tall as the room left in the hero, at most the whole card;
    // its lower part fades out, so the card has no bottom edge.
    <div className="relative mx-auto mt-8 flex min-h-0 w-full max-w-[1100px] items-start sm:mt-12 sm:flex-1">
      <div className="max-h-full w-full overflow-hidden [mask-image:linear-gradient(to_bottom,#000_55%,transparent)]">
        <div className="relative aspect-video overflow-hidden rounded-t-[14px] border border-b-0 border-white/10 bg-[#050607] sm:rounded-t-[20px]">
          {/* eslint-disable-next-line @next/next/no-img-element -- a plain poster, served as is */}
          <img src={`${CLIP_BASE}/${id}.jpg`} alt="" fetchPriority="high" className="absolute inset-0 size-full object-cover" />
          {side ? <ClipPlayer key={side.id} side={side} /> : null}
          {verdict ? (
            <span
              aria-hidden
              className={cn(
                "pointer-events-none absolute right-2.5 top-2.5 rounded-full px-2 py-0.5 font-mono text-[11px] font-medium backdrop-blur sm:right-5 sm:top-5 sm:px-2.5 sm:py-1 sm:text-[12px]",
                TONE[verdict],
              )}
            >
              {verdict}
            </span>
          ) : null}
        </div>
      </div>
    </div>
  );
}
