"use client";

import { useEffect } from "react";

type Box = [number, number, number, number, number]; // t, x, y, w, h (normalised to the source video)
type Frame = { t: number; left?: { box_xywh: number[] | null }; right?: { box_xywh: number[] | null } };
type Sidecar = { video?: { width?: number; height?: number }; hands?: { frames?: Frame[] } };
type Segment = [number, number];

/**
 * Every <video data-sidecar="…"> draws the hands model's real boxes from its clip's sidecar, synced to the video:
 * boxes are its sibling `.box[data-side=left|right]`, the card uses object-fit: cover with `data-pos-y` as the
 * vertical object-position. `data-flag="start-end,…"` turns the boxes amber inside flagged segments.
 * A `[data-clock]` sibling shows "analysing · 0:0s / 0:0d".
 */
export function LandingEffects() {
  useEffect(() => {
    const players = Array.from(document.querySelectorAll<HTMLVideoElement>(".ormes-landing video[data-sidecar]")).map((video) => {
      const card = video.parentElement as HTMLElement;
      const p = {
        video,
        card,
        posY: Number(video.dataset.posY ?? "0.5"),
        flags: (video.dataset.flag ?? "")
          .split(",")
          .filter(Boolean)
          .map((s) => s.split("-").map(Number) as Segment),
        boxes: {
          left: card.querySelector<HTMLElement>('.box[data-side="left"]'),
          right: card.querySelector<HTMLElement>('.box[data-side="right"]'),
        },
        clock: card.querySelector<HTMLElement>("[data-clock]"),
        tracks: { left: [] as Box[], right: [] as Box[] },
        w: 1280,
        h: 720,
      };
      fetch(video.dataset.sidecar as string)
        .then((r) => r.json())
        .then((d: Sidecar) => {
          p.w = d.video?.width ?? p.w;
          p.h = d.video?.height ?? p.h;
          for (const f of d.hands?.frames ?? []) {
            for (const side of ["left", "right"] as const) {
              const b = f[side]?.box_xywh;
              if (b) p.tracks[side].push([f.t, b[0], b[1], b[2], b[3]]);
            }
          }
        })
        .catch(() => {});
      return p;
    });

    const at = (track: Box[], t: number): Box | null => {
      for (let i = 0; i < track.length; i++) {
        const a = track[i];
        const n = track[i + 1];
        if (n && t >= a[0] && t <= n[0] && n[0] - a[0] <= 0.5) {
          const k = (t - a[0]) / (n[0] - a[0]);
          return [t, a[1] + (n[1] - a[1]) * k, a[2] + (n[2] - a[2]) * k, a[3] + (n[3] - a[3]) * k, a[4] + (n[4] - a[4]) * k];
        }
        if (Math.abs(t - a[0]) <= 0.15) return a;
      }
      return null;
    };

    let raf = 0;
    const tick = () => {
      for (const p of players) {
        const t = p.video.currentTime || 0;
        const cw = p.card.clientWidth;
        const ch = p.card.clientHeight;
        const sc = Math.max(cw / p.w, ch / p.h);
        const vw = p.w * sc;
        const vh = p.h * sc;
        const ox = (cw - vw) * 0.5;
        const oy = (ch - vh) * p.posY;
        const flagged = p.flags.some(([a, b]) => t >= a && t <= b);
        for (const side of ["left", "right"] as const) {
          const el = p.boxes[side];
          if (!el) continue;
          const b = at(p.tracks[side], t);
          if (!b) {
            el.style.opacity = "0";
            continue;
          }
          el.style.left = `${ox + b[1] * vw}px`;
          el.style.top = `${oy + b[2] * vh}px`;
          el.style.width = `${b[3] * vw}px`;
          el.style.height = `${b[4] * vh}px`;
          el.style.opacity = "1";
          el.classList.toggle("warn", flagged);
        }
        if (p.clock && p.video.duration) {
          p.clock.textContent = `analysing · 0:0${Math.floor(t)} / 0:0${Math.round(p.video.duration)}`;
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
    };
  }, []);
  return null;
}
