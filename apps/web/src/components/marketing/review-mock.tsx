"use client";

import { useEffect, useRef } from "react";

const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * The design's review-console mock. Its markup comes from the page; this wrapper animates the
 * queue (moves the selection and stamps decisions) exactly like the design's script, and stays
 * still when the visitor prefers reduced motion.
 */
export function ReviewMock({ children, ...props }: React.ComponentProps<"div">) {
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = root.current;
    if (!el || reducedMotion()) return;
    const rows = Array.from(el.querySelectorAll<HTMLElement>(".q div"));
    if (!rows.length) return;
    const keys = el.querySelectorAll<HTMLElement>(".acts span");
    const decisions = ["pilla", "pillr", "pilla", "pillr"];
    let i = 0;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const interval = setInterval(() => {
      const row = rows[i % rows.length];
      rows.forEach((r) => r.classList.remove("on"));
      row.classList.add("on");
      const key = keys[i % 2 ? 1 : 0];
      if (key) {
        key.style.transform = "scale(.96)";
        timers.push(setTimeout(() => (key.style.transform = ""), 180));
      }
      const tag = row.querySelector("b em");
      if (tag) {
        tag.className = decisions[i % 4];
        tag.textContent = decisions[i % 4] === "pilla" ? "accept" : "reject";
      }
      i++;
    }, 1800);
    return () => {
      clearInterval(interval);
      timers.forEach(clearTimeout);
    };
  }, []);
  return (
    <div ref={root} {...props}>
      {children}
    </div>
  );
}

/** The small first-person scene inside the mock: two hands, plates and a flagged document. */
export function ReviewMockCanvas() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    const x = c?.getContext("2d");
    if (!c || !x) return;
    const rm = reducedMotion();
    const t0 = performance.now();
    let frame = 0;
    let R = c.getBoundingClientRect();
    const size = () => {
      R = c.getBoundingClientRect();
      const d = Math.min(window.devicePixelRatio || 1, 2);
      c.width = R.width * d;
      c.height = R.height * d;
      x.setTransform(d, 0, 0, d, 0, 0);
    };
    const hand = (px: number, py: number, W: number, H: number) => {
      x.fillStyle = "#c79a7c";
      x.beginPath();
      x.ellipse(px, py, W * 0.035, H * 0.07, -0.3, 0, 7);
      x.fill();
      x.fillRect(px - W * 0.015, py, W * 0.03, H);
      x.strokeStyle = "rgba(126,214,168,.9)";
      x.lineWidth = 1.2;
      x.strokeRect(px - W * 0.05, py - H * 0.1, W * 0.1, H * 0.2);
    };
    const draw = (now: number) => {
      const t = (now - t0) / 1000;
      const W = R.width;
      const H = R.height;
      x.clearRect(0, 0, W, H);
      x.fillStyle = "#14171b";
      x.fillRect(0, 0, W, H);
      x.fillStyle = "#2a2420";
      x.fillRect(0, H * 0.55, W, H * 0.45);
      for (let i = 0; i < 4; i++) {
        x.fillStyle = "#d9d6cf";
        x.beginPath();
        x.ellipse(W * (0.2 + i * 0.15), H * 0.68, W * 0.05, H * 0.04, 0, 0, 7);
        x.fill();
      }
      x.strokeStyle = "rgba(143,180,255,.9)";
      x.setLineDash([4, 3]);
      x.strokeRect(W * 0.66, H * 0.18, W * 0.2, H * 0.26);
      x.setLineDash([]);
      x.fillStyle = "rgba(143,180,255,.9)";
      x.font = "500 9px JetBrains Mono,monospace";
      x.fillText("DOCUMENT", W * 0.66, H * 0.15);
      const a = Math.sin(t * 1.3);
      const b = Math.cos(t * 1.1);
      hand(W * (0.32 + a * 0.06), H * (0.62 + b * 0.04), W, H);
      hand(W * (0.52 - b * 0.05), H * (0.66 + a * 0.03), W, H);
      if (!rm) frame = requestAnimationFrame(draw);
    };
    // Resizing clears the canvas; with reduced motion nothing else would repaint it.
    const onResize = () => {
      size();
      if (rm) draw(performance.now());
    };
    size();
    window.addEventListener("resize", onResize);
    frame = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", onResize);
    };
  }, []);
  return <canvas id="mv" ref={ref} aria-hidden="true" />;
}
