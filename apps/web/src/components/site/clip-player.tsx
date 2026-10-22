"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { useReducedMotion } from "./use-playback";

/**
 * Real footage slot for the marketing pages (issue #60): plays a clip from /media/clips with the
 * hands model's boxes drawn on top, from the clip's JSON sidecar. Until a clip id is set, or when
 * the clip can't be loaded, the caller's fallback is shown instead.
 *
 * The sidecar type is the subset this player reads; the full type lives with #60's
 * `lib/clip-overlay.ts` and can replace it once that lands.
 */

export const CLIP_BASE = "/media/clips";

type Box = [number, number, number, number];
type HandRow = { state: "full" | "truncated" | "absent"; box: Box | null };
export type ClipSidecar = {
  id: string;
  video: { mp4: string; webm: string; poster: string; width: number; height: number };
  hands: { frames: { t: number; left: HandRow; right: HandRow }[] };
  decision: { decision: "accept" | "reject" | "review"; reasons: { check: string; code: string; message: string }[] } | null;
};

const COLOR = { full: "#7ed6a8", truncated: "#ff8a7a", absent: "transparent" } as const;

/** Loads a clip's sidecar. `null` while loading, `"missing"` when it can't be read. */
export function useClip(id: string | null) {
  const [state, setState] = useState<{ id: string; side: ClipSidecar | "missing" } | null>(null);
  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    fetch(`${CLIP_BASE}/${id}.json`)
      .then((r) => (r.ok ? (r.json() as Promise<ClipSidecar>) : Promise.reject(new Error(String(r.status)))))
      .then((side) => !cancelled && setState({ id, side }))
      .catch(() => !cancelled && setState({ id, side: "missing" }));
    return () => {
      cancelled = true;
    };
  }, [id]);
  if (!id) return "missing" as const;
  return state?.id === id ? state.side : null;
}

function frameAt(frames: ClipSidecar["hands"]["frames"], t: number) {
  let best = frames[0];
  for (const f of frames) if (Math.abs(f.t - t) < Math.abs(best.t - t)) best = f;
  return best;
}

/** A muted, looping clip with live hand boxes. Shows the poster still with reduced motion. */
export function ClipPlayer({ side, className }: { side: ClipSidecar; className?: string }) {
  const video = useRef<HTMLVideoElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const reduced = useReducedMotion();

  useEffect(() => {
    const v = video.current;
    const c = canvas.current;
    const cx = c?.getContext("2d");
    if (!v || !c || !cx || side.hands.frames.length === 0) return;
    let raf = 0;
    const draw = () => {
      const r = c.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      if (c.width !== Math.round(r.width * dpr)) {
        c.width = Math.round(r.width * dpr);
        c.height = Math.round(r.height * dpr);
      }
      cx.setTransform(dpr, 0, 0, dpr, 0, 0);
      cx.clearRect(0, 0, r.width, r.height);
      // The video is drawn with object-cover: map the normalised boxes through the same scale and crop.
      const scale = Math.max(r.width / side.video.width, r.height / side.video.height);
      const w = side.video.width * scale;
      const h = side.video.height * scale;
      const ox = (r.width - w) / 2;
      const oy = (r.height - h) / 2;
      const f = frameAt(side.hands.frames, v.currentTime);
      for (const hand of [f.left, f.right]) {
        if (!hand.box || hand.state === "absent") continue;
        const [x0, y0, x1, y1] = hand.box.map((n) => Math.min(1, Math.max(0, n)));
        cx.strokeStyle = COLOR[hand.state];
        cx.lineWidth = 1.5;
        cx.strokeRect(ox + x0 * w, oy + y0 * h, (x1 - x0) * w, (y1 - y0) * h);
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [side]);

  const src = (p: string) => (p.startsWith("/") ? p : `${CLIP_BASE}/${p}`);
  return (
    <div className={cn("absolute inset-0", className)} aria-hidden="true">
      <video
        ref={video}
        className="absolute inset-0 size-full object-cover"
        poster={src(side.video.poster)}
        autoPlay={!reduced}
        muted
        loop
        playsInline
        preload="metadata"
      >
        <source src={src(side.video.webm)} type="video/webm" />
        <source src={src(side.video.mp4)} type="video/mp4" />
      </video>
      <canvas ref={canvas} className="absolute inset-0 size-full" />
    </div>
  );
}
