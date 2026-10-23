"use client";

import { useEffect } from "react";

type Box = [number, number, number, number, number]; // t, x, y, w, h (normalised to the source video)
type Frame = { t: number; left: { box_xywh: number[] | null }; right: { box_xywh: number[] | null } };

/**
 * Navbar gets its scrolled state past half the hero; the product timeline playhead follows its video;
 * the hero draws the hands model's real boxes for its clip (from the clip's sidecar), synced to the video.
 */
export function LandingEffects() {
  useEffect(() => {
    const nav = document.querySelector<HTMLElement>(".ormes-landing .nav");
    const hero = document.querySelector<HTMLElement>(".ormes-landing .hero");
    const onScroll = () => nav?.classList.toggle("scrolled", window.scrollY > (hero?.offsetHeight ?? 0) / 2);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });

    const pv = document.getElementById("pv") as HTMLVideoElement | null;
    const ph = document.getElementById("ph");
    const hv = document.getElementById("hv") as HTMLVideoElement | null;
    const hs = document.getElementById("hs");
    const els = { left: document.getElementById("bl"), right: document.getElementById("br") };
    const tracks: { left: Box[]; right: Box[] } = { left: [], right: [] };
    let srcW = 720;
    let srcH = 1280;

    fetch("/media/clips/hero-lemons.json")
      .then((r) => r.json())
      .then((d: { video?: { width?: number; height?: number }; hands?: { frames?: Frame[] } }) => {
        srcW = d.video?.width ?? srcW;
        srcH = d.video?.height ?? srcH;
        for (const f of d.hands?.frames ?? []) {
          for (const side of ["left", "right"] as const) {
            const b = f[side]?.box_xywh;
            if (b) tracks[side].push([f.t, b[0], b[1], b[2], b[3]]);
          }
        }
      })
      .catch(() => {});

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

    // The card shows the video with object-fit: cover and object-position: 50% 88%.
    const place = (el: HTMLElement, b: Box, card: HTMLElement) => {
      const cw = card.clientWidth;
      const ch = card.clientHeight;
      const sc = Math.max(cw / srcW, ch / srcH);
      const vw = srcW * sc;
      const vh = srcH * sc;
      const ox = (cw - vw) * 0.5;
      const oy = (ch - vh) * 0.88;
      el.style.left = `${ox + b[1] * vw}px`;
      el.style.top = `${oy + b[2] * vh}px`;
      el.style.width = `${b[3] * vw}px`;
      el.style.height = `${b[4] * vh}px`;
    };

    let raf = 0;
    const tick = () => {
      if (pv && ph && pv.duration) ph.style.left = `${(pv.currentTime / pv.duration) * 100}%`;
      if (hv && hv.parentElement) {
        const t = hv.currentTime || 0;
        for (const side of ["left", "right"] as const) {
          const el = els[side];
          if (!el) continue;
          const b = at(tracks[side], t);
          if (b) {
            place(el, b, hv.parentElement);
            el.style.opacity = "1";
          } else el.style.opacity = "0";
        }
        if (hs) hs.textContent = `analysing · 0:0${Math.floor(t)} / 0:08`;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      window.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(raf);
    };
  }, []);
  return null;
}
