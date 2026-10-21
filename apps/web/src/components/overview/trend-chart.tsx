"use client";

import { useState } from "react";
import type { TrendDay } from "@/lib/domain/overview";
import { formatDay } from "@/lib/format";

const SERIES = [
  { key: "accept", label: "Accepted", color: "var(--chart-accept)" },
  { key: "review", label: "Sent to review", color: "var(--chart-review)" },
  { key: "reject", label: "Rejected", color: "var(--chart-reject)" },
  { key: "pending", label: "Not decided yet", color: "var(--chart-pending)" },
] as const;

const W = 640;
const H = 220;
const PAD = { top: 12, right: 8, bottom: 26, left: 34 };
const GAP = 2;

function niceMax(n: number): number {
  if (n <= 5) return 5;
  const pow = 10 ** Math.floor(Math.log10(n));
  const step = [1, 2, 2.5, 5, 10].find((s) => s * pow * 4 >= n)! * pow;
  return step * 4;
}

/** Stacked columns, one per day: accepted, sent to review, rejected, not decided. */
export function TrendChart({ days }: { days: TrendDay[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const totals = days.map((d) => d.accept + d.reject + d.review + d.pending);
  const max = niceMax(Math.max(1, ...totals));
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;
  const band = plotW / days.length;
  const barW = Math.min(24, band * 0.62);
  const y = (v: number) => PAD.top + plotH - (v / max) * plotH;
  const ticks = [0, max / 4, max / 2, (3 * max) / 4, max];
  const active = hover !== null ? days[hover] : null;

  return (
    <div className="grid gap-4">
      <ul className="flex flex-wrap gap-x-4 gap-y-1.5 text-[12.5px] text-muted-foreground" aria-label="Legend">
        {SERIES.map((s) => (
          <li key={s.key} className="flex items-center gap-1.5">
            <span className="size-2.5 rounded-[3px]" style={{ background: s.color }} aria-hidden />
            {s.label}
          </li>
        ))}
      </ul>
      <div className="relative">
        <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full overflow-visible" role="img" aria-label={`Videos per day over the last ${days.length} days, by decision. A table follows.`}>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={PAD.left} x2={W - PAD.right} y1={y(t)} y2={y(t)} stroke="var(--border)" strokeWidth={1} />
              <text x={PAD.left - 8} y={y(t)} dy="0.32em" textAnchor="end" className="fill-muted-foreground font-mono text-[10px]">
                {Math.round(t)}
              </text>
            </g>
          ))}
          {days.map((d, i) => {
            const cx = PAD.left + band * i + band / 2;
            let acc = 0;
            const segments = SERIES.map((s) => ({ ...s, value: d[s.key] })).filter((s) => s.value > 0);
            return (
              <g key={d.day} opacity={hover === null || hover === i ? 1 : 0.45} className="transition-opacity">
                {segments.map((s, j) => {
                  const top = y(acc + s.value);
                  const bottom = y(acc);
                  acc += s.value;
                  const isTop = j === segments.length - 1;
                  const h = Math.max(0, bottom - top - (j > 0 ? GAP : 0));
                  const r = isTop ? Math.min(4, h / 2, barW / 2) : 0;
                  const x0 = cx - barW / 2;
                  const yTop = top;
                  const yBot = yTop + h;
                  const path = `M${x0},${yBot} L${x0},${yTop + r} Q${x0},${yTop} ${x0 + r},${yTop} L${x0 + barW - r},${yTop} Q${x0 + barW},${yTop} ${x0 + barW},${yTop + r} L${x0 + barW},${yBot} Z`;
                  return <path key={s.key} d={path} fill={s.color} />;
                })}
                {(i % 2 === days.length % 2 || i === days.length - 1) && (
                  <text x={cx} y={H - 8} textAnchor="middle" className="fill-muted-foreground font-mono text-[10px]">
                    {i === days.length - 1 ? "Today" : formatDay(d.day)}
                  </text>
                )}
                <rect
                  x={PAD.left + band * i}
                  y={PAD.top}
                  width={band}
                  height={plotH}
                  fill="transparent"
                  onMouseEnter={() => setHover(i)}
                  onMouseLeave={() => setHover(null)}
                />
              </g>
            );
          })}
        </svg>
        {active && hover !== null && (
          <div
            className="pointer-events-none absolute top-2 z-10 w-44 -translate-x-1/2 rounded-lg border border-border bg-popover p-2.5 text-[12px] shadow-lg"
            style={{ left: `${((PAD.left + band * hover + band / 2) / W) * 100}%` }}
            role="presentation"
          >
            <p className="mb-1.5 font-medium">{hover === days.length - 1 ? "Today" : formatDay(active.day)}</p>
            {SERIES.map((s) => (
              <p key={s.key} className="flex items-center justify-between gap-2 text-muted-foreground">
                <span className="flex items-center gap-1.5">
                  <span className="size-2 rounded-[2px]" style={{ background: s.color }} aria-hidden />
                  {s.label}
                </span>
                <span className="font-mono text-foreground tabular-nums">{active[s.key]}</span>
              </p>
            ))}
          </div>
        )}
      </div>
      <div className="sr-only">
      <table>
        <caption>Videos per day by decision</caption>
        <thead>
          <tr>
            <th scope="col">Day</th>
            {SERIES.map((s) => (
              <th key={s.key} scope="col">
                {s.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {days.map((d) => (
            <tr key={d.day}>
              <th scope="row">{formatDay(d.day)}</th>
              {SERIES.map((s) => (
                <td key={s.key}>{d[s.key]}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      </div>
    </div>
  );
}
