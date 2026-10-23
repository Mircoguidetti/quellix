"use client";

import { useEffect, useRef } from "react";
import { CircleCheck, CircleX, Clock, ScanLine, UserRoundSearch } from "lucide-react";
import { Example, ICON } from "../primitives";
import { usePlayback } from "../use-playback";

/**
 * Home's orchestrated moment, "where videos go": an example month of 10,000 videos flows through
 * Ormes into three lanes. Each thumbnail stands for 250 videos; the counters and the review-hours
 * bars below are driven by the same arrivals, so the whole section tells one story.
 */

type Lane = "accept" | "review" | "reject";
// `color` outlines the (dark) thumbnails; `token` is the surface's status colour for lanes and counters.
const LANES: { key: Lane; y: number; label: string; color: string; token: string; icon: typeof CircleCheck; final: number }[] = [
  { key: "accept", y: 60, label: "Accept", color: "#7ed6a8", token: "var(--brand-ok)", icon: CircleCheck, final: 8000 },
  { key: "review", y: 180, label: "Review", color: "#8fb4ff", token: "var(--brand)", icon: UserRoundSearch, final: 1500 },
  { key: "reject", y: 300, label: "Reject", color: "#ff8a7a", token: "var(--brand-no)", icon: CircleX, final: 500 },
];
const PER_THUMB = 250;
const TOTAL = 10_000;
const MINUTES_PER_VIDEO = 3;
const HOURS_WITHOUT = (TOTAL * MINUTES_PER_VIDEO) / 60; // 500
const HOURS_WITH = (1500 * MINUTES_PER_VIDEO) / 60; // 75

const SPAWN_MS = 280;
const TRAVEL_MS = 3000;
const HOLD_MS = 2600;
const GATE_X = 330;

function path(y: number) {
  return `M -60 180 L ${GATE_X} 180 C 450 180 440 ${y} 560 ${y} L 780 ${y}`;
}

/** 32 accept, 6 review, 2 reject (x250 videos), in a fixed shuffled order (seeded, so server and client agree). */
const SEQUENCE: Lane[] = (() => {
  const out: Lane[] = [...Array(32).fill("accept"), ...Array(6).fill("review"), ...Array(2).fill("reject")];
  let seed = 7;
  const rand = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
})();

/** Where the pool of thumbnails sits at rest (and with reduced motion). */
const REST: { x: number; y: number; lane?: Lane }[] = [
  { x: 40, y: 180 },
  { x: 130, y: 180 },
  { x: 220, y: 180 },
  { x: 470, y: 112, lane: "accept" },
  { x: 610, y: 60, lane: "accept" },
  { x: 672, y: 60, lane: "accept" },
  { x: 640, y: 180, lane: "review" },
  { x: 560, y: 300, lane: "reject" },
];
const POOL = 14;
const TINTS = ["#1b2533", "#22201b", "#1a2420", "#251c22", "#1d1f27"];

const fmt = (n: number) => n.toLocaleString("en-US");

export function VideoFlow() {
  const rootRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const thumbs = useRef<(SVGGElement | null)[]>([]);
  const frames = useRef<(SVGRectElement | null)[]>([]);
  const counters = useRef<Record<Lane | "total", HTMLElement | null>>({ accept: null, review: null, reject: null, total: null });
  const bars = useRef<{ without: HTMLElement | null; with: HTMLElement | null; withoutLabel: HTMLElement | null; withLabel: HTMLElement | null }>({
    without: null,
    with: null,
    withoutLabel: null,
    withLabel: null,
  });
  const playing = usePlayback(rootRef);

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const setFinal = () => {
      for (const l of LANES) if (counters.current[l.key]) counters.current[l.key]!.textContent = fmt(l.final);
      if (counters.current.total) counters.current.total.textContent = fmt(TOTAL);
      const b = bars.current;
      if (b.without && b.with && b.withoutLabel && b.withLabel) {
        b.without.style.width = "100%";
        b.with.style.width = `${(HOURS_WITH / HOURS_WITHOUT) * 100}%`;
        b.withoutLabel.textContent = `${HOURS_WITHOUT} h`;
        b.withLabel.textContent = `${HOURS_WITH} h`;
      }
      thumbs.current.forEach((g, i) => {
        if (!g) return;
        const r = REST[i];
        g.style.opacity = r ? "1" : "0";
        if (r) g.setAttribute("transform", `translate(${r.x} ${r.y})`);
        const frame = frames.current[i];
        if (frame) frame.setAttribute("stroke", r?.lane ? LANES.find((l) => l.key === r.lane)!.color : "rgba(255,255,255,0.28)");
      });
    };
    if (!playing) {
      setFinal();
      return;
    }

    const paths = Object.fromEntries(
      LANES.map((l) => {
        const p = document.createElementNS("http://www.w3.org/2000/svg", "path");
        p.setAttribute("d", path(l.y));
        return [l.key, p];
      }),
    ) as Record<Lane, SVGPathElement>;
    const lengths = Object.fromEntries(LANES.map((l) => [l.key, paths[l.key].getTotalLength()])) as Record<Lane, number>;
    const gateAt = GATE_X + 60; // distance along every path where the trunk ends

    let start = performance.now();
    let raf = 0;
    const counts: Record<Lane, number> = { accept: 0, review: 0, reject: 0 };
    let arrived = 0;

    const tick = (now: number) => {
      let t = now - start;
      const cycle = SEQUENCE.length * SPAWN_MS + TRAVEL_MS + HOLD_MS;
      if (t > cycle) {
        start = now;
        t = 0;
        counts.accept = counts.review = counts.reject = 0;
        arrived = 0;
      }
      // Arrivals: thumbnails whose travel is done.
      const done = Math.max(0, Math.min(SEQUENCE.length, Math.floor((t - TRAVEL_MS) / SPAWN_MS) + 1));
      while (arrived < done) {
        counts[SEQUENCE[arrived]] += 1;
        arrived += 1;
      }
      for (const l of LANES) {
        const el = counters.current[l.key];
        if (el) el.textContent = fmt(counts[l.key] * PER_THUMB);
      }
      if (counters.current.total) counters.current.total.textContent = fmt(arrived * PER_THUMB);
      const b = bars.current;
      const hWithout = (arrived * PER_THUMB * MINUTES_PER_VIDEO) / 60;
      const hWith = (counts.review * PER_THUMB * MINUTES_PER_VIDEO) / 60;
      if (b.without && b.with && b.withoutLabel && b.withLabel) {
        b.without.style.width = `${(hWithout / HOURS_WITHOUT) * 100}%`;
        b.with.style.width = `${(hWith / HOURS_WITHOUT) * 100}%`;
        b.withoutLabel.textContent = `${Math.round(hWithout)} h`;
        b.withLabel.textContent = `${Math.round(hWith)} h`;
      }

      // Thumbnails in flight, drawn from a small pool.
      const first = Math.max(0, Math.floor((t - TRAVEL_MS) / SPAWN_MS) + 1);
      const last = Math.min(SEQUENCE.length - 1, Math.floor(t / SPAWN_MS));
      for (let s = 0; s < POOL; s++) {
        const g = thumbs.current[s];
        if (!g) continue;
        const idx = first + s;
        if (idx > last) {
          g.style.opacity = "0";
          continue;
        }
        const lane = SEQUENCE[idx];
        const p = (t - idx * SPAWN_MS) / TRAVEL_MS;
        const eased = p;
        const len = lengths[lane];
        const pt = paths[lane].getPointAtLength(Math.min(1, eased) * len);
        g.setAttribute("transform", `translate(${pt.x.toFixed(1)} ${pt.y.toFixed(1)})`);
        g.style.opacity = p > 0.88 ? String(Math.max(0, (1 - p) / 0.12)) : "1";
        const frame = frames.current[s];
        if (frame) frame.setAttribute("stroke", eased * len > gateAt ? LANES.find((l) => l.key === lane)!.color : "rgba(255,255,255,0.28)");
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing]);

  return (
    <div ref={rootRef}>
      <figure className="rounded-[22px] border border-hairline bg-panel p-4 sm:p-8">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <p className="text-[14px] text-muted-foreground">
            Videos received <span ref={(el) => void (counters.current.total = el)} className="tabular ml-2 text-foreground">{fmt(TOTAL)}</span>
          </p>
          <Example>Example month</Example>
        </div>
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-[minmax(0,1fr)_200px]">
          <svg ref={svgRef} viewBox="0 0 720 360" className="block h-auto w-full overflow-hidden text-foreground" aria-hidden="true">
            <defs>
              <linearGradient id="vf-fade" x1="0" x2="1">
                <stop offset="0" stopColor="currentColor" stopOpacity="0" />
                <stop offset="0.25" stopColor="currentColor" stopOpacity="0.2" />
              </linearGradient>
            </defs>
            {LANES.map((l) => (
              <path key={l.key} d={path(l.y)} fill="none" style={{ stroke: l.token }} strokeOpacity={0.45} strokeWidth="1.5" strokeDasharray="2 6" />
            ))}
            <path d={path(180)} fill="none" stroke="url(#vf-fade)" strokeWidth="1.5" />
            {Array.from({ length: POOL }, (_, i) => {
              const r = REST[i];
              const tint = TINTS[i % TINTS.length];
              return (
                <g
                  key={i}
                  ref={(el) => void (thumbs.current[i] = el)}
                  transform={r ? `translate(${r.x} ${r.y})` : "translate(-100 180)"}
                  style={{ opacity: r ? 1 : 0 }}
                >
                  <rect
                    ref={(el) => void (frames.current[i] = el)}
                    x="-24"
                    y="-16"
                    width="48"
                    height="32"
                    rx="6"
                    fill={tint}
                    stroke={r?.lane ? LANES.find((l) => l.key === r.lane)!.color : "rgba(255,255,255,0.28)"}
                    strokeWidth="1.5"
                  />
                  <path d={`M -24 ${6 - (i % 3) * 3} L -8 ${-2 + (i % 2) * 4} L 6 ${4 - (i % 3)} L 24 ${-4 + (i % 4)}`} stroke="rgba(255,255,255,0.18)" fill="none" />
                  <circle cx={-6 + (i % 5) * 4} cy={4 - (i % 3) * 3} r="4" fill="rgba(143,180,255,0.55)" />
                </g>
              );
            })}
            <g transform={`translate(${GATE_X - 40} 136)`}>
              <rect width="88" height="88" rx="20" fill="#121417" stroke="rgba(143,180,255,0.5)" strokeWidth="1.5" />
              <ScanLine x="24" y="24" width="40" height="40" color="#8fb4ff" strokeWidth={1.5} />
            </g>
          </svg>
          <ul className="grid grid-cols-3 gap-3 sm:grid-cols-1 sm:grid-rows-3 sm:gap-0">
            {LANES.map((l) => (
              <li key={l.key} className="flex items-center">
                <div className="w-full border-l-2 pl-3 sm:pl-4" style={{ borderColor: l.token }}>
                  <p className="inline-flex items-center gap-1.5 text-[13px] text-muted-foreground sm:text-[14px]">
                    <l.icon {...ICON} className="size-3.5 sm:size-4" style={{ color: l.token }} />
                    {l.label}
                  </p>
                  <p ref={(el) => void (counters.current[l.key] = el)} className="tabular font-mono text-[20px] leading-tight text-foreground sm:text-[28px]">
                    {fmt(l.final)}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </div>
        <figcaption className="sr-only">
          Example month of 10,000 videos: 8,000 accepted, 1,500 sent to review and 500 rejected. Review hours fall from 500 to 75.
        </figcaption>

        <div className="mt-8 border-t border-hairline pt-6">
          <p className="mb-4 inline-flex items-center gap-2 text-[14px] text-muted-foreground">
            <Clock {...ICON} className="size-4" />
            Review hours, at 3 minutes a video
          </p>
          <dl className="flex flex-col gap-4">
            <div className="grid grid-cols-[110px_minmax(0,1fr)] items-center gap-3 sm:grid-cols-[150px_minmax(0,1fr)]">
              <dt className="text-[14px] text-muted-foreground">Without Ormes</dt>
              <dd className="flex items-center gap-3">
                <span className="h-3 flex-1 overflow-hidden rounded-full bg-foreground/[0.04]">
                  <span ref={(el) => void (bars.current.without = el)} className="block h-full rounded-full bg-foreground/35" style={{ width: "100%" }} />
                </span>
                <span ref={(el) => void (bars.current.withoutLabel = el)} className="tabular w-14 text-right font-mono text-[15px] text-foreground">
                  {HOURS_WITHOUT} h
                </span>
              </dd>
            </div>
            <div className="grid grid-cols-[110px_minmax(0,1fr)] items-center gap-3 sm:grid-cols-[150px_minmax(0,1fr)]">
              <dt className="text-[14px] text-foreground">With Ormes</dt>
              <dd className="flex items-center gap-3">
                <span className="h-3 flex-1 overflow-hidden rounded-full bg-foreground/[0.04]">
                  <span ref={(el) => void (bars.current.with = el)} className="block h-full rounded-full bg-brand" style={{ width: "15%" }} />
                </span>
                <span ref={(el) => void (bars.current.withLabel = el)} className="tabular w-14 text-right font-mono text-[15px] text-brand">
                  {HOURS_WITH} h
                </span>
              </dd>
            </div>
          </dl>
          <p className="mt-4 text-[13px] text-muted-foreground">Only the videos sent to review are watched by a person. Your pilot report shows your own numbers.</p>
        </div>
      </figure>
    </div>
  );
}
