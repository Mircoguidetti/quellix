"use client";

import { useEffect, useRef } from "react";

/** The landing hero: a viewfinder over a field of frame tiles, with a hand trajectory being traced. */
export function HeroCanvas() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const cv = ref.current;
    const cx = cv?.getContext("2d");
    if (!cv || !cx) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let W = 0;
    let H = 0;
    let trail: { x: number; y: number; z: number }[] = [];
    let t0 = performance.now();
    let frame = 0;

    const size = () => {
      const r = cv.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      W = r.width;
      H = r.height;
      cv.width = W * dpr;
      cv.height = H * dpr;
      cx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    const pt = (t: number) => {
      const ox = W * 0.5;
      const oy = H * 0.52;
      const x = Math.sin(t * 0.9) * W * 0.27 + Math.sin(t * 2.1) * W * 0.04;
      const y = Math.cos(t * 0.7) * H * 0.2 + Math.sin(t * 1.6) * H * 0.05;
      return { x: ox + x, y: oy + y, z: (Math.sin(t * 0.5) + 1) / 2 };
    };
    const grid = () => {
      const step = Math.max(28, W / 26);
      cx.fillStyle = "rgba(255,255,255,0.07)";
      for (let gx = step / 2; gx < W; gx += step) for (let gy = step / 2; gy < H; gy += step) cx.fillRect(gx, gy, 1, 1);
      const dw = W * 0.13;
      const dh = dw * 0.7;
      const dx = W * 0.12;
      const dy = H * 0.62;
      cx.fillStyle = "rgba(143,180,255,0.16)";
      cx.fillRect(dx, dy, dw, dh);
      cx.strokeStyle = "rgba(143,180,255,0.45)";
      cx.setLineDash([4, 4]);
      cx.lineWidth = 1;
      cx.strokeRect(dx, dy, dw, dh);
      cx.setLineDash([]);
      cx.font = '500 10px "JetBrains Mono", ui-monospace, monospace';
      cx.fillStyle = "rgba(143,180,255,0.85)";
      cx.fillText("DOCUMENT FLAGGED", dx, dy + dh + 16);
    };
    const finder = (p: { x: number; y: number }) => {
      const w = W * 0.58;
      const h = H * 0.56;
      const x = W * 0.5 - w / 2;
      const y = H * 0.52 - h / 2;
      const c = 18;
      cx.strokeStyle = "rgba(242,243,245,0.35)";
      cx.lineWidth = 1.5;
      cx.beginPath();
      cx.moveTo(x, y + c);
      cx.lineTo(x, y);
      cx.lineTo(x + c, y);
      cx.moveTo(x + w - c, y);
      cx.lineTo(x + w, y);
      cx.lineTo(x + w, y + c);
      cx.moveTo(x + w, y + h - c);
      cx.lineTo(x + w, y + h);
      cx.lineTo(x + w - c, y + h);
      cx.moveTo(x + c, y + h);
      cx.lineTo(x, y + h);
      cx.lineTo(x, y + h - c);
      cx.stroke();
      const inside = p.x > x && p.x < x + w && p.y > y && p.y < y + h;
      cx.font = '500 11px "JetBrains Mono", ui-monospace, monospace';
      cx.fillStyle = inside ? "rgba(126,214,168,0.8)" : "rgba(255,138,122,0.85)";
      cx.fillText(inside ? "HANDS IN FRAME" : "HAND OUT OF FRAME", x, y - 10);
    };
    const draw = (now: number) => {
      const t = (now - t0) / 1000;
      cx.clearRect(0, 0, W, H);
      grid();
      const p = pt(t);
      trail.push(p);
      if (trail.length > 140) trail.shift();
      for (let i = 1; i < trail.length; i++) {
        const a = i / trail.length;
        const q = trail[i];
        cx.strokeStyle = `rgba(143,180,255,${(a * 0.55).toFixed(3)})`;
        cx.lineWidth = 0.6 + q.z * 2.2;
        cx.beginPath();
        cx.moveTo(trail[i - 1].x, trail[i - 1].y);
        cx.lineTo(q.x, q.y);
        cx.stroke();
      }
      for (let j = 0; j < trail.length; j += 14) {
        const r = trail[j];
        cx.fillStyle = `rgba(242,243,245,${(0.15 + (0.5 * j) / trail.length).toFixed(3)})`;
        cx.beginPath();
        cx.arc(r.x, r.y, 1.6 + r.z * 1.4, 0, Math.PI * 2);
        cx.fill();
      }
      cx.fillStyle = "#8fb4ff";
      cx.beginPath();
      cx.arc(p.x, p.y, 3.5 + p.z * 2.5, 0, Math.PI * 2);
      cx.fill();
      cx.strokeStyle = "rgba(143,180,255,0.35)";
      cx.beginPath();
      cx.arc(p.x, p.y, 10 + p.z * 5, 0, Math.PI * 2);
      cx.stroke();
      finder(p);
      if (!reduced) frame = requestAnimationFrame(draw);
    };
    const still = () => {
      let t = 0;
      trail = [];
      for (let k = 0; k < 140; k++) {
        t = 3 + k * 0.03;
        trail.push(pt(t));
      }
      t0 = performance.now() - t * 1000;
      draw(performance.now());
    };
    const onResize = () => {
      size();
      if (reduced) still();
    };
    size();
    window.addEventListener("resize", onResize);
    if (reduced) still();
    else frame = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", onResize);
    };
  }, []);

  return <canvas id="hc" ref={ref} aria-hidden="true" />;
}
