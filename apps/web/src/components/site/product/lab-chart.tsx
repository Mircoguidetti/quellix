"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { Example } from "../primitives";

/**
 * Product §6: reject precision and recall per rubric version, against the lab's reject rate
 * (what a random reject would score as precision). Example data. Colours validated for the dark
 * panel with the dataviz palette validator.
 */
const DATA = [
  { v: "v1", precision: 0.82, recall: 0.64, review: 0.19 },
  { v: "v2", precision: 0.89, recall: 0.74, review: 0.15 },
  { v: "v3", precision: 0.94, recall: 0.81, review: 0.12 },
];
const LAB_REJECT_RATE = 0.09;
const SERIES = [
  { key: "precision" as const, label: "Reject precision", color: "#4f82e6" },
  { key: "recall" as const, label: "Reject recall", color: "#b07d24" },
];

const W = 560;
const H = 280;
const PAD = { l: 44, r: 112, t: 16, b: 34 };
const x = (i: number) => PAD.l + (i * (W - PAD.l - PAD.r)) / (DATA.length - 1);
const y = (v: number) => PAD.t + (1 - v) * (H - PAD.t - PAD.b);
const pct = (v: number) => `${Math.round(v * 100)}%`;

export function LabChart() {
  const [hover, setHover] = useState<number | null>(null);
  const last = DATA.length - 1;
  const h = hover ?? last;

  return (
    <figure className="rounded-[22px] border border-hairline bg-panel p-5 sm:p-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <figcaption className="font-mono text-[12.5px] text-muted-foreground">report · load the dishwasher · per rubric version</figcaption>
        <Example />
      </div>
      <ul className="mb-3 flex flex-wrap gap-x-5 gap-y-1 text-[13px] text-muted-foreground" aria-label="Legend">
        {SERIES.map((s) => (
          <li key={s.key} className="inline-flex items-center gap-2">
            <span className="h-0.5 w-4 rounded" style={{ background: s.color }} />
            {s.label}
          </li>
        ))}
        <li className="inline-flex items-center gap-2">
          <span className="w-4 border-t border-dashed border-white/50" />
          Lab reject rate
        </li>
      </ul>
      <div className="relative">
        <svg viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full" role="img" aria-label="Reject precision rises from 82% to 94% and recall from 64% to 81% between rubric versions 1 and 3, against a lab reject rate of 9%.">
          {[0, 0.25, 0.5, 0.75, 1].map((t) => (
            <g key={t}>
              <line x1={PAD.l} x2={W - PAD.r} y1={y(t)} y2={y(t)} stroke="rgba(255,255,255,0.07)" />
              <text x={PAD.l - 10} y={y(t) + 4} textAnchor="end" className="fill-muted-foreground font-mono text-[11px]">
                {pct(t)}
              </text>
            </g>
          ))}
          {DATA.map((d, i) => (
            <text key={d.v} x={x(i)} y={H - 10} textAnchor="middle" className={cn("font-mono text-[12px]", i === h ? "fill-foreground" : "fill-muted-foreground")}>
              {d.v}
            </text>
          ))}
          <line x1={PAD.l} x2={W - PAD.r} y1={y(LAB_REJECT_RATE)} y2={y(LAB_REJECT_RATE)} stroke="rgba(255,255,255,0.5)" strokeDasharray="4 4" />
          <text x={W - PAD.r + 8} y={y(LAB_REJECT_RATE) + 4} className="fill-muted-foreground text-[12px]">
            lab 9%
          </text>
          {hover !== null ? <line x1={x(hover)} x2={x(hover)} y1={PAD.t} y2={H - PAD.b} stroke="rgba(255,255,255,0.18)" /> : null}
          {SERIES.map((s) => (
            <g key={s.key}>
              <polyline points={DATA.map((d, i) => `${x(i)},${y(d[s.key])}`).join(" ")} fill="none" stroke={s.color} strokeWidth="2" strokeLinejoin="round" />
              {DATA.map((d, i) => (
                <circle key={d.v} cx={x(i)} cy={y(d[s.key])} r={i === h ? 5 : 4} fill={s.color} stroke="#0b0c0e" strokeWidth="2" />
              ))}
              <text x={W - PAD.r + 8} y={y(DATA[last][s.key]) + 4} className="fill-foreground text-[12px]">
                {s.label.replace("Reject ", "")} {DATA[last][s.key].toFixed(2)}
              </text>
            </g>
          ))}
          {DATA.map((d, i) => (
            <rect
              key={d.v}
              x={x(i) - 40}
              y={PAD.t}
              width={80}
              height={H - PAD.t - PAD.b}
              fill="transparent"
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
              onClick={() => setHover(i)}
            />
          ))}
        </svg>
      </div>
      <dl className="mt-4 grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-hairline bg-hairline text-[13px] sm:grid-cols-4">
        {[
          ["Version", DATA[h].v],
          ["Reject precision", DATA[h].precision.toFixed(2)],
          ["Reject recall", DATA[h].recall.toFixed(2)],
          ["Sent to review", pct(DATA[h].review)],
        ].map(([k, v]) => (
          <div key={k} className="bg-panel px-3 py-2.5">
            <dt className="text-muted-foreground">{k}</dt>
            <dd className="tabular font-mono text-[15px] text-foreground">{v}</dd>
          </div>
        ))}
      </dl>
      <details className="mt-3 text-[13px] text-muted-foreground">
        <summary className="cursor-pointer">Show as a table</summary>
        <table className="mt-2 w-full text-left font-mono text-[12.5px]">
          <thead>
            <tr className="text-muted-foreground">
              <th className="py-1 font-normal">Version</th>
              <th className="py-1 font-normal">Precision</th>
              <th className="py-1 font-normal">Recall</th>
              <th className="py-1 font-normal">Sent to review</th>
            </tr>
          </thead>
          <tbody className="text-foreground">
            {DATA.map((d) => (
              <tr key={d.v} className="border-t border-hairline">
                <td className="py-1">{d.v}</td>
                <td className="py-1">{d.precision.toFixed(2)}</td>
                <td className="py-1">{d.recall.toFixed(2)}</td>
                <td className="py-1">{pct(d.review)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-2">Lab reject rate 9%: a reject chosen at random would be right 9% of the time.</p>
      </details>
    </figure>
  );
}
