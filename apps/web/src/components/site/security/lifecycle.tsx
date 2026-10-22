"use client";

import { useRef } from "react";
import type { LucideIcon } from "lucide-react";
import { Clock, Cpu, Scale, Trash2, Upload } from "lucide-react";
import { cn } from "@/lib/utils";
import { ICON } from "../primitives";
import { usePlayback } from "../use-playback";
import s from "./security.module.css";

type Node = { icon: LucideIcon; title: string; text: string; tone?: "end" | "wait"; cls: string };

const MAIN: Node[] = [
  { icon: Upload, title: "Upload", text: "To private storage through a signed URL that expires. No public link exists.", cls: s.n1 },
  { icon: Cpu, title: "Analysis", text: "The worker downloads it, runs the checks and writes the decision.", cls: s.n2 },
  { icon: Scale, title: "Decision", text: "Reasons, measurements and the rubric version are written.", cls: s.n3 },
  { icon: Trash2, title: "Deleted", text: "Right after an accept or reject. A failed analysis too, after the last retry.", tone: "end", cls: s.n4 },
];
const BRANCH: Node[] = [
  { icon: Clock, title: "Waiting for review", text: "Kept until a person decides, 14 days at most.", tone: "wait", cls: s.n5 },
  { icon: Trash2, title: "Deleted", text: "Once a person decides, or on day 14 either way.", tone: "end", cls: s.n6 },
];

const COLS = ["12.5%", "37.5%", "62.5%", "87.5%"];
const ROW1 = 28; // centre of the first row of icons, px
const ROW2 = 268; // centre of the second row

function NodeIcon({ node, small }: { node: Node; small?: boolean }) {
  return (
    <span
      className={cn(
        "relative z-10 inline-flex shrink-0 items-center justify-center rounded-full border bg-black",
        small ? "size-12" : "size-14",
        node.tone === "end" ? "border-white/25 text-muted-foreground" : node.tone === "wait" ? "border-brand/50 text-brand" : "border-white/30 text-foreground",
      )}
    >
      <node.icon {...ICON} className="size-[22px]" />
    </span>
  );
}

/** Security §1: the life of a video, with the review branch. Desktop runs left to right, mobile top to bottom. */
export function Lifecycle() {
  const ref = useRef<HTMLDivElement>(null);
  const playing = usePlayback(ref);
  return (
    <div ref={ref} data-play={playing ? "" : undefined} className="rounded-[24px] border border-hairline bg-panel p-5 sm:p-8">
      {/* Desktop */}
      <div className="relative hidden h-[400px] md:block" style={{ "--row1": `${ROW1}px`, "--row2": `${ROW2}px` } as React.CSSProperties}>
        <span aria-hidden className="absolute h-px bg-white/15" style={{ top: ROW1, left: COLS[0], right: "12.5%" }} />
        <span aria-hidden className="absolute w-px border-l border-dashed border-brand/50" style={{ left: COLS[2], top: ROW1, height: ROW2 - ROW1 }} />
        <span aria-hidden className="absolute h-px border-t border-dashed border-brand/50" style={{ top: ROW2, left: COLS[2], width: "25%" }} />
        <span aria-hidden className={cn(s.dot, "absolute z-[5] size-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white shadow-[0_0_0_4px_rgba(255,255,255,0.15)]")} style={{ top: ROW1 }} />
        <span aria-hidden className={cn(s.branchDot, "absolute z-[5] size-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-brand shadow-[0_0_0_4px_rgba(143,180,255,0.2)]")} />
        <ol>
          {MAIN.map((n, i) => (
            <li key={n.title} className={cn(n.cls, "absolute flex w-[22%] -translate-x-1/2 flex-col items-center text-center")} style={{ left: COLS[i], top: 0 }}>
              <NodeIcon node={n} />
              <div className="relative z-10 mt-3 bg-panel px-2 pb-1 pt-1">
                <h3 className="text-[16px] font-medium">{n.title}</h3>
                <p className="mt-1 text-[14px] leading-relaxed text-muted-foreground">{n.text}</p>
              </div>
            </li>
          ))}
        </ol>
        <p className="absolute -translate-x-1/2 rounded-full border border-brand/30 bg-black px-2.5 py-0.5 font-mono text-[11.5px] text-brand" style={{ left: COLS[2], top: 168 }}>
          if review
        </p>
        <ol>
          {BRANCH.map((n, i) => (
            <li key={n.title + i} className={cn(n.cls, "absolute flex w-[22%] -translate-x-1/2 flex-col items-center text-center")} style={{ left: COLS[i + 2], top: ROW2 - ROW1 }}>
              <NodeIcon node={n} />
              <h3 className="mt-4 text-[16px] font-medium">{n.title}</h3>
              <p className="mt-1 text-[14px] leading-relaxed text-muted-foreground">{n.text}</p>
              {i === 0 ? (
                <span aria-hidden className="mt-3 block h-1 w-32 overflow-hidden rounded-full bg-brand/15">
                  <span className={cn(s.days, "block h-full w-full rounded-full bg-brand/70")} />
                </span>
              ) : null}
            </li>
          ))}
        </ol>
      </div>

      {/* Mobile */}
      <div className="md:hidden">
        <div className="relative">
          <span aria-hidden className="absolute bottom-[104px] left-6 top-6 w-px bg-white/15" />
          <span aria-hidden className="absolute bottom-[104px] left-6 top-6 w-0">
            <span className={cn(s.vdot, "absolute left-0 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white")} />
          </span>
          <ol className="flex flex-col">
            {MAIN.map((n) => (
              <li key={n.title} className={cn(n.cls, "flex h-[128px] gap-4")}>
                <NodeIcon node={n} small />
                <div className="pt-2.5">
                  <h3 className="text-[16px] font-medium">{n.title}</h3>
                  <p className="mt-1 text-[14px] leading-relaxed text-muted-foreground">{n.text}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
        <div className="mt-2 rounded-2xl border border-dashed border-brand/40 p-4">
          <p className="mb-4 font-mono text-[11.5px] text-brand">if the decision is review</p>
          <ol className="flex flex-col gap-5">
            {BRANCH.map((n, i) => (
              <li key={n.title + i} className={cn(n.cls, "flex gap-4")}>
                <NodeIcon node={n} small />
                <div className="pt-1.5">
                  <h3 className="text-[16px] font-medium">{n.title}</h3>
                  <p className="mt-1 text-[14px] leading-relaxed text-muted-foreground">{n.text}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </div>
  );
}
