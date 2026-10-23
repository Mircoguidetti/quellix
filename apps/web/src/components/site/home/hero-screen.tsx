"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { CLIP_BASE, ClipPlayer, useClip, type ClipSidecar } from "../clip-player";
import { SITE_CLIPS } from "../clips";

// A dark backing keeps the chip readable over bright footage.
const TONE = { accept: "bg-black/65 text-ok", review: "bg-black/65 text-brand", reject: "bg-black/65 text-no" } as const;

const clock = (s: number) => `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

/** The reason shown in the corner: the clip's first reason with its times, as the worker wrote it. */
function reasonOf(side: ClipSidecar) {
  const r = side.decision?.reasons[0];
  if (!r) return { text: "No reasons: every check passed", at: null };
  const seg = r.segments?.[0];
  return { text: r.message, at: seg ? `${clock(seg.start_s)}–${clock(seg.end_s)}` : null };
}

/**
 * The hero's clip card (issue #69): the same 16:9 clip at every width. The poster is in the server
 * HTML (it is the LCP); the clip with its hand boxes starts after the page has loaded. The live
 * Ormes UI stays small, in the corners, and shows the worker's real output for this clip.
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
  const reason = side ? reasonOf(side) : null;

  return (
    <div className="relative mx-auto mt-10 w-full max-w-[1100px] sm:mt-14">
      <div className="relative aspect-video overflow-hidden rounded-[14px] border border-white/10 bg-[#050607] shadow-[0_40px_120px_-40px_rgba(143,180,255,0.35)] sm:rounded-[20px]">
        {/* eslint-disable-next-line @next/next/no-img-element -- a plain poster, served as is */}
        <img src={`${CLIP_BASE}/${id}.jpg`} alt="" fetchPriority="high" className="absolute inset-0 size-full object-cover" />
        {side ? <ClipPlayer key={side.id} side={side} /> : null}

        {/* Live Ormes UI, small and in the corners. */}
        <div aria-hidden className="pointer-events-none absolute inset-0">
          <span className="absolute left-2.5 top-2.5 inline-flex items-center gap-1.5 rounded-full bg-black/55 px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.1em] text-white/80 backdrop-blur sm:left-5 sm:top-5 sm:px-2.5 sm:py-1 sm:text-[10.5px]">
            <i className="size-1.5 rounded-full bg-no motion-safe:animate-pulse" /> Ormes · live
          </span>
          {verdict ? (
            <span className={cn("absolute right-2.5 top-2.5 rounded-full px-2 py-0.5 font-mono text-[11px] font-medium backdrop-blur sm:right-5 sm:top-5 sm:px-2.5 sm:py-1 sm:text-[12px]", TONE[verdict])}>
              {verdict}
            </span>
          ) : null}
          {reason ? (
            <p className="absolute bottom-2.5 left-2.5 right-2.5 flex flex-wrap items-center gap-x-2 rounded-lg bg-black/60 px-2.5 py-1.5 text-[11.5px] text-white backdrop-blur sm:bottom-5 sm:left-5 sm:right-auto sm:max-w-[420px] sm:rounded-xl sm:px-3 sm:py-2 sm:text-[13px]">
              <span>{reason.text}</span>
              {reason.at ? <span className="font-mono text-[11px] text-white/70 sm:text-[12px]">· {reason.at}</span> : null}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
