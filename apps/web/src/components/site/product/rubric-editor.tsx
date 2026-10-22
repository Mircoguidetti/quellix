"use client";

import { useId, useState } from "react";
import { FileInput, GitCommitHorizontal, Library, Save } from "lucide-react";
import { cn } from "@/lib/utils";
import { ICON, Soon } from "../primitives";

/** Hand-visibility ratios of recent decisions near the threshold (example data); the other 156 are far from it. */
const NEAR = [0.58, 0.63, 0.66, 0.69, 0.71, 0.73, 0.74, 0.76, 0.77, 0.785, 0.795, 0.805, 0.826, 0.834, 0.842, 0.851, 0.858, 0.866, 0.874, 0.881, 0.889, 0.896];
const SAVED_MIN = 80;
const TOTAL = 178;

function changed(min: number) {
  return NEAR.filter((r) => r < min / 100 !== r < SAVED_MIN / 100).length;
}

function Toggle({ label, on, onChange }: { label: string; on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={() => onChange(!on)}
      className={cn("relative h-5 w-9 shrink-0 rounded-full transition-colors", on ? "bg-[#0b0c0e]" : "bg-[#dcdfe3]")}
    >
      <span className={cn("absolute left-0 top-0.5 size-4 rounded-full bg-white shadow transition-transform", on ? "translate-x-[18px]" : "translate-x-0.5")} />
    </button>
  );
}

function Row({ children, label, hint }: { children: React.ReactNode; label: React.ReactNode; hint?: string }) {
  return (
    <div className="flex flex-col gap-2 border-t border-[#eef0f3] py-4 first:border-t-0 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
      <div>
        <p className="text-[14px] font-medium">{label}</p>
        {hint ? <p className="text-[12.5px] text-[#5c626b]">{hint}</p> : null}
      </div>
      {children}
    </div>
  );
}

const PRIVACY = [
  { kind: "Faces", value: "review" },
  { kind: "Documents", value: "review" },
  { kind: "Screens", value: "ignore" },
];

const VERSIONS = [
  { v: 1, date: "Sep 2", text: "Created from the lab’s spec" },
  { v: 2, date: "Sep 18", text: "Hands minimum 75% → 80%" },
  { v: 3, date: "Oct 9", text: "Screens: review → ignore" },
];

/** Product §3: a light rubric editor next to its version history. The hands slider is live. */
export function RubricEditor() {
  const id = useId();
  const [min, setMin] = useState(82);
  const [taskCritical, setTaskCritical] = useState(true);
  const [framingCritical, setFramingCritical] = useState(false);
  const [privacy, setPrivacy] = useState(PRIVACY.map((p) => p.value));
  const n = changed(min);
  const dirty = min !== SAVED_MIN || !taskCritical || framingCritical || privacy.some((v, i) => v !== PRIVACY[i].value);

  return (
    <div className="grid gap-5 lg:grid-cols-[1.35fr_1fr]">
      <div className="overflow-hidden rounded-[22px] bg-white text-[#0b0c0e]">
        <div className="flex items-center justify-between border-b border-[#e6e8eb] px-5 py-3.5">
          <p className="font-mono text-[12.5px] text-[#5c626b]">rubric · load the dishwasher · v3</p>
          <span className="rounded-full bg-[#f4f5f7] px-2 py-0.5 text-[12px] text-[#5c626b]">Example</span>
        </div>
        <div className="px-5">
          <Row label={<label htmlFor={`${id}-hands`}>Hands, while handling objects</label>} hint="Both hands, share of handling time">
            <div className="flex items-center gap-3 sm:w-[260px]">
              <input
                id={`${id}-hands`}
                type="range"
                min={50}
                max={95}
                value={min}
                onChange={(e) => setMin(Number(e.target.value))}
                className="h-1.5 flex-1 cursor-pointer accent-[#0b0c0e]"
              />
              <output htmlFor={`${id}-hands`} className="tabular w-[92px] whitespace-nowrap rounded-md border border-[#e6e8eb] px-2 py-1 text-right font-mono text-[13px]">
                min {min}%
              </output>
            </div>
          </Row>
          <Row label="Task completed" hint="Below 70% confidence goes to review">
            <span className="flex items-center gap-2.5 text-[13px] text-[#5c626b]">
              critical <Toggle label="Task completed is critical" on={taskCritical} onChange={setTaskCritical} />
            </span>
          </Row>
          <Row label="Framing" hint="Off target at most 10%">
            <span className="flex items-center gap-2.5 text-[13px] text-[#5c626b]">
              critical <Toggle label="Framing is critical" on={framingCritical} onChange={setFramingCritical} />
            </span>
          </Row>
          <Row label="Privacy" hint="Per kind of detection">
            <div className="flex flex-wrap gap-2">
              {PRIVACY.map((p, i) => (
                <label key={p.kind} className="flex items-center gap-1.5 rounded-lg border border-[#e6e8eb] py-1 pl-2.5 pr-1 text-[12.5px]">
                  {p.kind}
                  <select
                    value={privacy[i]}
                    onChange={(e) => setPrivacy((cur) => cur.map((v, j) => (j === i ? e.target.value : v)))}
                    className="cursor-pointer rounded-md bg-[#f4f5f7] px-1.5 py-0.5 font-mono text-[12px]"
                  >
                    <option value="reject">reject</option>
                    <option value="review">review</option>
                    <option value="ignore">ignore</option>
                  </select>
                </label>
              ))}
            </div>
          </Row>
        </div>
      </div>

      <div className="flex flex-col rounded-[22px] border border-hairline bg-panel p-5 sm:p-6">
        <p className="mb-5 inline-flex items-center gap-2 text-[14px] text-muted-foreground">
          <GitCommitHorizontal {...ICON} className="size-4" /> Versions
        </p>
        <ol className="relative flex flex-col gap-5 pl-7">
          <span aria-hidden className="absolute bottom-3 left-[7px] top-2 w-px bg-hairline" />
          {VERSIONS.map((v) => (
            <li key={v.v} className="relative">
              <span aria-hidden className="absolute -left-7 top-1 size-[15px] rounded-full border-2 border-panel bg-white/30 ring-1 ring-white/20" />
              <p className="flex items-baseline gap-2">
                <span className="font-mono text-[13px]">v{v.v}</span>
                <span className="font-mono text-[11.5px] text-muted-foreground">{v.date}</span>
              </p>
              <p className="text-[14px] text-muted-foreground">{v.text}</p>
            </li>
          ))}
          <li className="relative">
            <span aria-hidden className={cn("absolute -left-7 top-1 size-[15px] rounded-full border-2 border-panel ring-1", dirty ? "bg-brand ring-brand motion-safe:animate-pulse" : "bg-panel ring-white/20")} />
            <p className="flex items-baseline gap-2">
              <span className="font-mono text-[13px] text-brand">v4</span>
              <span className="font-mono text-[11.5px] text-muted-foreground">draft</span>
            </p>
            <p className="text-[14px]" aria-live="polite">
              {dirty ? (
                <>
                  Saving creates v4 · <b className="tabular font-medium text-brand">{n}</b> of {TOTAL} decisions would change
                </>
              ) : (
                <span className="text-muted-foreground">Nothing to save</span>
              )}
            </p>
          </li>
        </ol>
        <span className="mt-6 inline-flex h-10 w-fit items-center gap-2 rounded-full bg-white px-4 text-[14px] font-medium text-black">
          <Save {...ICON} className="size-4" /> Save as v4
        </span>
        <p className="mt-3 text-[12.5px] text-muted-foreground">Old decisions keep the version they used. Move the hands slider to preview the effect.</p>
      </div>

      <ul className="grid gap-4 sm:grid-cols-2 lg:col-span-2">
        <li className="flex gap-3.5 rounded-2xl border border-dashed border-hairline p-5">
          <FileInput {...ICON} className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
          <div>
            <h3 className="flex items-center gap-2 text-[16px] font-medium">
              From the lab’s spec <Soon />
            </h3>
            <p className="mt-1 text-[14px] leading-relaxed text-muted-foreground">Paste the lab’s guidelines and Ormes drafts the rubric, each value tied to the line it came from.</p>
          </div>
        </li>
        <li className="flex gap-3.5 rounded-2xl border border-dashed border-hairline p-5">
          <Library {...ICON} className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
          <div>
            <h3 className="flex items-center gap-2 text-[16px] font-medium">
              A library of specs <Soon />
            </h3>
            <p className="mt-1 text-[14px] leading-relaxed text-muted-foreground">Ready rubrics for common task families: kitchen, laundry, factory assembly.</p>
          </div>
        </li>
      </ul>
    </div>
  );
}
