"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { cn } from "@/lib/utils";
import { CLIP_BASE, ClipPlayer, useClip, type ClipSidecar } from "../clip-player";
import { SITE_CLIPS } from "../clips";
import { HeroCanvas } from "./hero-canvas";

const TONE = { accept: "bg-ok/15 text-ok", review: "bg-brand/15 text-brand", reject: "bg-no/15 text-no" } as const;
const PORTRAIT = "(max-width: 639px)";

function subscribePortrait(onChange: () => void) {
  const mq = window.matchMedia(PORTRAIT);
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}

const clock = (s: number) => `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

/** The reason shown in the corner: the clip's first reason with its times, or the example's. */
function reasonOf(side: ClipSidecar | null) {
  if (!side) return { text: "Readable document", at: "00:12", example: true };
  const r = side.decision?.reasons[0];
  if (!r) return { text: "No reasons: every check passed", at: null, example: false };
  const seg = r.segments?.[0];
  return { text: r.message, at: seg ? `${clock(seg.start_s)}–${clock(seg.end_s)}` : null, example: false };
}

/**
 * The hero's clip card (issue #69): landscape from 640 px up, portrait (9:16) below. With real clips
 * configured (SITE_CLIPS.hero) the poster is in the server HTML (it is the LCP) and the clip with its
 * hand boxes starts after the page has loaded; until then the drawn viewfinder fills the same card.
 * The live Ormes UI stays small, in the corners.
 */
export function HeroScreen() {
  const { landscape, portrait } = SITE_CLIPS.hero;
  // null on the server: no clip is chosen until the client knows its screen.
  const isPortrait = useSyncExternalStore<boolean | null>(subscribePortrait, () => window.matchMedia(PORTRAIT).matches, () => null);
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

  // Load only the clip this screen shows.
  const id = isPortrait === null ? null : isPortrait ? portrait : landscape;
  const clip = useClip(id);
  const side = clip && clip !== "missing" ? clip : null;
  const hasClips = Boolean(landscape || portrait);
  const verdict = side?.decision?.decision ?? (hasClips ? null : "review");
  const reason = reasonOf(side);

  return (
    <div className="relative mx-auto mt-10 w-full max-w-[1100px] sm:mt-14">
      <div className="relative aspect-[9/16] overflow-hidden rounded-[20px] border border-white/10 bg-[#050607] shadow-[0_40px_120px_-40px_rgba(143,180,255,0.35)] sm:aspect-video">
        {hasClips ? (
          <picture>
            {portrait ? <source media={PORTRAIT} srcSet={`${CLIP_BASE}/${portrait}.jpg`} /> : null}
            <img src={`${CLIP_BASE}/${landscape ?? portrait}.jpg`} alt="" fetchPriority="high" className="absolute inset-0 size-full object-cover" />
          </picture>
        ) : null}
        {side && loaded ? <ClipPlayer key={side.id} side={side} /> : hasClips ? null : <HeroCanvas />}

        {/* Live Ormes UI, small and in the corners. */}
        <div aria-hidden className="pointer-events-none absolute inset-0 p-3 sm:p-5">
          <span className="absolute left-3 top-3 inline-flex items-center gap-1.5 rounded-full bg-black/55 px-2.5 py-1 font-mono text-[10.5px] uppercase tracking-[0.1em] text-white/80 backdrop-blur sm:left-5 sm:top-5">
            <i className="size-1.5 rounded-full bg-no motion-safe:animate-pulse" /> Ormes · live
          </span>
          {verdict ? (
            <span className={cn("absolute right-3 top-3 rounded-full px-2.5 py-1 font-mono text-[12px] font-medium backdrop-blur sm:right-5 sm:top-5", TONE[verdict])}>{verdict}</span>
          ) : null}
        </div>
        {verdict ? (
          <p className="absolute bottom-3 left-3 right-3 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-xl bg-black/60 px-3 py-2 text-[13px] text-white backdrop-blur sm:bottom-5 sm:left-5 sm:right-auto sm:max-w-[420px]">
            <span>{reason.text}</span>
            {reason.at ? <span className="font-mono text-[12px] text-white/70">· {reason.at}</span> : null}
            {reason.example ? <span className="rounded border border-white/25 px-1 text-[11px] text-white/70">Example</span> : null}
          </p>
        ) : null}
      </div>
    </div>
  );
}
