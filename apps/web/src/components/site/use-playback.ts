"use client";

import { useEffect, useState, type RefObject } from "react";

/** True when the user asked for reduced motion. False on the server and before hydration. */
export function useReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);
  return reduced;
}

/**
 * Whether an animated visual should play: it is on screen, the tab is visible and the user has not
 * asked for reduced motion. Every visual renders its final state when this is false, so the page
 * is complete at rest, on the server and with reduced motion.
 */
export function usePlayback(ref: RefObject<Element | null>, { threshold = 0.25 } = {}) {
  const reduced = useReducedMotion();
  const [inView, setInView] = useState(false);
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(([entry]) => setInView(entry.isIntersecting), { threshold });
    io.observe(el);
    return () => io.disconnect();
  }, [ref, threshold]);

  useEffect(() => {
    const update = () => setVisible(document.visibilityState === "visible");
    update();
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, []);

  return inView && visible && !reduced;
}
