"use client";

import { useEffect } from "react";

/** Navbar gets its scrolled state past half the hero; the product timeline playhead follows the video. */
export function LandingEffects() {
  useEffect(() => {
    const nav = document.querySelector<HTMLElement>(".ormes-landing .nav");
    const hero = document.querySelector<HTMLElement>(".ormes-landing .hero");
    const onScroll = () => nav?.classList.toggle("scrolled", window.scrollY > (hero?.offsetHeight ?? 0) / 2);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });

    const video = document.getElementById("pv") as HTMLVideoElement | null;
    const head = document.getElementById("ph");
    let raf = 0;
    const tick = () => {
      if (video && head && video.duration) head.style.left = `${(video.currentTime / video.duration) * 100}%`;
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
