"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Film, Inbox, LayoutGrid, ListChecks, Scale, Settings, X } from "lucide-react";
import { Logo } from "@/components/logo";
import { cn } from "@/lib/utils";
import { ICON } from "../primitives";
import { usePlayback } from "../use-playback";

type Verdict = "accept" | "reject";
type Reason = { tag: "review" | "pass" | "fail"; text: string; at: string };
type Item = {
  id: string;
  summary: string;
  verdict: Verdict;
  box: { left: string; top: string; w: string; h: string; label: string };
  marks: { left: number; width: number; tone: "review" | "fail" }[];
  reasons: Reason[];
};

const QUEUE: Item[] = [
  {
    id: "v_89148",
    summary: "Task may end before the door closes",
    verdict: "accept",
    box: { left: "58%", top: "30%", w: "26%", h: "44%", label: "door 02:38" },
    marks: [{ left: 86, width: 8, tone: "review" }],
    reasons: [
      { tag: "review", text: "Last step found with confidence 0.62", at: "02:38" },
      { tag: "pass", text: "Both hands visible while handling, 88%", at: "min 80%" },
    ],
  },
  {
    id: "v_89163",
    summary: "Readable document at 00:27",
    verdict: "reject",
    box: { left: "16%", top: "48%", w: "24%", h: "30%", label: "document 00:27" },
    marks: [
      { left: 14, width: 5, tone: "review" },
      { left: 61, width: 4, tone: "review" },
    ],
    reasons: [
      { tag: "review", text: "Readable document visible", at: "00:27" },
      { tag: "pass", text: "Both hands visible while handling, 91%", at: "min 80%" },
      { tag: "pass", text: "All 3 steps found", at: "00:03 → 02:41" },
    ],
  },
  {
    id: "v_89179",
    summary: "Camera off the work 32% of the time",
    verdict: "accept",
    box: { left: "8%", top: "10%", w: "40%", h: "38%", label: "off target" },
    marks: [
      { left: 22, width: 18, tone: "review" },
      { left: 70, width: 12, tone: "review" },
    ],
    reasons: [
      { tag: "review", text: "Camera off the work 32% of the time", at: "max 10%" },
      { tag: "pass", text: "All 4 steps found", at: "00:06 → 03:12" },
    ],
  },
  {
    id: "v_89189",
    summary: "Right hand cut by the edge, 00:41–00:52",
    verdict: "reject",
    box: { left: "70%", top: "52%", w: "22%", h: "40%", label: "right hand 00:41" },
    marks: [{ left: 30, width: 9, tone: "fail" }],
    reasons: [
      { tag: "review", text: "Right hand cut by the edge", at: "00:41–00:52" },
      { tag: "pass", text: "All 3 steps found", at: "00:04 → 02:20" },
    ],
  },
  {
    id: "v_89199",
    summary: "Not sure the last step happened",
    verdict: "accept",
    box: { left: "40%", top: "20%", w: "30%", h: "50%", label: "step 3 02:51" },
    marks: [{ left: 90, width: 6, tone: "review" }],
    reasons: [
      { tag: "review", text: "Step 3 found with confidence 0.55", at: "02:51" },
      { tag: "pass", text: "No faces, documents or screens", at: "" },
    ],
  },
];

const NAV = [
  { icon: LayoutGrid, label: "Overview" },
  { icon: Inbox, label: "Review", count: 11, on: true },
  { icon: Film, label: "Videos" },
  { icon: ListChecks, label: "Rubrics" },
  { icon: Scale, label: "Contests" },
  { icon: Settings, label: "Settings" },
];

type Lit = Verdict | "J" | "Enter" | null;
type State = { index: number; lit: Lit; decided: Record<string, Verdict>; head: number };

const STEP_MS = 3800;
// Still frame: the second video, playhead on its first flagged moment.
const REST: State = { index: 1, lit: null, decided: {}, head: 14 };

function Key({ children, lit }: { children: React.ReactNode; lit?: boolean }) {
  return (
    <kbd
      className={cn(
        "inline-flex h-6 min-w-6 items-center justify-center rounded-md border border-black/15 bg-white px-1.5 font-mono text-[12px] font-medium text-[#0b0c0e] shadow-[0_1px_0_rgba(0,0,0,0.15)] transition-all duration-150",
        lit && "translate-y-px border-[#8fb4ff] bg-[#8fb4ff] text-black shadow-[0_0_0_4px_rgba(143,180,255,0.3)]",
      )}
    >
      {children}
    </kbd>
  );
}

/**
 * Product, Review: the app's review screen running on its own. For each video the reviewer presses
 * J to reach the flagged moment, Enter to replay it, then A or R; the queue moves on.
 */
export function ReviewConsole() {
  const ref = useRef<HTMLDivElement>(null);
  const playing = usePlayback(ref);
  const [state, setState] = useState<State>(REST);

  useEffect(() => {
    if (!playing) return;
    let i = 0;
    const timers: number[] = [];
    const run = () => {
      const item = QUEUE[i];
      const mark = item.marks[0];
      const at = (ms: number, f: (st: State) => State) => timers.push(window.setTimeout(() => setState(f), ms));
      at(600, (st) => ({ ...st, lit: "J", head: mark.left }));
      at(900, (st) => ({ ...st, lit: null }));
      at(1000, (st) => ({ ...st, head: mark.left + mark.width }));
      at(1700, (st) => ({ ...st, lit: "Enter", head: mark.left }));
      at(2000, (st) => ({ ...st, lit: null }));
      at(2500, (st) => ({ ...st, lit: item.verdict }));
      at(2950, (st) => ({ ...st, lit: null, decided: { ...st.decided, [item.id]: item.verdict } }));
      timers.push(
        window.setTimeout(() => {
          i = (i + 1) % QUEUE.length;
          setState((st) => ({ index: i, lit: null, decided: i === 0 ? {} : st.decided, head: 2 }));
          run();
        }, STEP_MS),
      );
    };
    timers.push(window.setTimeout(() => setState({ index: 0, lit: null, decided: {}, head: 2 }), 0));
    run();
    return () => timers.forEach(clearTimeout);
  }, [playing]);

  // At rest (off screen, reduced motion, server) the console shows its still frame.
  const { index, lit, decided, head } = playing ? state : REST;
  const item = QUEUE[index];
  const waiting = 11 - Object.keys(decided).length;

  return (
    <div
      ref={ref}
      role="img"
      aria-label="The Ormes review screen: a queue of doubtful videos, the selected video with its flagged moments, and Accept and Reject keys"
      className="overflow-hidden rounded-[22px] border border-hairline bg-white text-[#0b0c0e] shadow-[0_40px_120px_-40px_rgba(143,180,255,0.25)]"
    >
      <div className="grid md:grid-cols-[196px_minmax(0,1fr)]">
        <aside className="surface-dark hidden flex-col gap-1 bg-[#0b0c0e] p-4 text-[13.5px] text-white/60 md:flex" aria-hidden="true">
          <Logo className="mb-5 px-2 pt-1 text-[13px] text-white" />
          {NAV.map(({ icon: Icon, label, count, on }) => (
            <span key={label} className={cn("flex items-center gap-2.5 rounded-lg px-2 py-1.5", on && "bg-white/10 text-white")}>
              <Icon {...ICON} className="size-4" />
              {label}
              {count ? <em className="tabular ml-auto rounded-full bg-brand/20 px-1.5 font-mono text-[11px] not-italic text-brand">{waiting}</em> : null}
            </span>
          ))}
          <span className="mt-auto rounded-lg border border-white/10 px-2.5 py-2 text-[12px]">
            <b className="block font-medium text-white">Northwind Capture</b>Example data
          </span>
        </aside>
        <div className="min-w-0" aria-hidden="true">
          <div className="flex items-center justify-between border-b border-[#e6e8eb] px-5 py-3.5">
            <h4 className="text-[15px] font-medium">Review</h4>
            <span className="inline-flex items-center gap-1.5 text-[12.5px] text-[#5c626b]">
              <span className="tabular">{waiting}</span> waiting
            </span>
          </div>
          <div className="grid lg:grid-cols-[250px_minmax(0,1fr)]">
            <ul className="flex gap-2 overflow-hidden border-b border-[#e6e8eb] p-3 lg:flex-col lg:gap-0 lg:border-b-0 lg:border-r lg:p-2">
              {QUEUE.map((q, i) => {
                const verdict = decided[q.id];
                return (
                  <li
                    key={q.id}
                    className={cn(
                      "min-w-[200px] rounded-xl px-3 py-2.5 transition-all duration-300 lg:min-w-0",
                      i === index ? "bg-[#eef3ff] ring-1 ring-[#c9d8f7]" : "bg-[#fafafb] lg:bg-transparent",
                      verdict && "opacity-45",
                    )}
                  >
                    <span className="flex items-center gap-2 font-mono text-[12px]">
                      {q.id}
                      {verdict ? (
                        <span className={cn("ml-auto inline-flex items-center gap-1 rounded px-1.5 text-[11px]", verdict === "accept" ? "bg-[#e8f7ef] text-[#15703f]" : "bg-[#fdeeeb] text-[#b5321f]")}>
                          {verdict === "accept" ? <Check {...ICON} className="size-3" /> : <X {...ICON} className="size-3" />}
                          {verdict === "accept" ? "accepted" : "rejected"}
                        </span>
                      ) : (
                        <span className="ml-auto rounded bg-[#ebf1ff] px-1.5 text-[11px] text-[#2a56b8]">review</span>
                      )}
                    </span>
                    <span className="mt-1 block truncate text-[13px] text-[#5c626b]">{q.summary}</span>
                  </li>
                );
              })}
            </ul>
            <div className="min-w-0 p-4 sm:p-5">
              <div className="relative aspect-video overflow-hidden rounded-xl bg-[linear-gradient(160deg,#2a2f38,#15181d_60%,#1d2027)]">
                <div className="absolute inset-x-[10%] bottom-0 h-[38%] rounded-t-[30%] bg-white/[0.06]" />
                <div className="absolute bottom-[18%] left-[30%] h-[22%] w-[18%] rounded-full bg-[#c7a98d]/25" />
                <div
                  key={item.id}
                  className="absolute rounded-md border-[1.5px] border-[#8fb4ff] transition-all duration-500 motion-safe:animate-in motion-safe:fade-in motion-safe:zoom-in-95"
                  style={{ left: item.box.left, top: item.box.top, width: item.box.w, height: item.box.h }}
                >
                  <span className="absolute -top-5 left-0 whitespace-nowrap rounded bg-[#8fb4ff] px-1.5 font-mono text-[10.5px] text-black">{item.box.label}</span>
                </div>
                <span className="absolute left-3 top-3 font-mono text-[11px] text-white/60">{item.id}</span>
              </div>
              <div className="relative mt-3 h-2 rounded-full bg-[#eef0f3]">
                {item.marks.map((m) => (
                  <i
                    key={m.left}
                    className={cn("absolute inset-y-0 rounded-full", m.tone === "fail" ? "bg-[#f3c9c2]" : "bg-[#c9d8f7]")}
                    style={{ left: `${m.left}%`, width: `${m.width}%` }}
                  />
                ))}
                <span className="absolute -top-1 h-4 w-0.5 rounded bg-[#0b0c0e] transition-[left] duration-700 ease-linear" style={{ left: `${head}%` }} />
              </div>
              <ul className="mt-4 flex flex-col gap-2">
                {item.reasons.map((r) => (
                  <li key={r.text} className="flex items-center gap-2.5 text-[13px]">
                    <span
                      className={cn(
                        "w-14 shrink-0 rounded px-1.5 py-px text-center font-mono text-[11px]",
                        r.tag === "pass" ? "bg-[#e8f7ef] text-[#15703f]" : "bg-[#ebf1ff] text-[#2a56b8]",
                      )}
                    >
                      {r.tag}
                    </span>
                    <span className="min-w-0 flex-1 truncate">{r.text}</span>
                    <span className="hidden shrink-0 font-mono text-[11.5px] text-[#5c626b] sm:inline">{r.at}</span>
                  </li>
                ))}
              </ul>
              <div className="mt-5 flex flex-wrap gap-2 text-[13px]">
                <span className={cn("inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 transition-colors", lit === "accept" ? "border-[#7ed6a8] bg-[#e8f7ef]" : "border-[#e6e8eb]")}>
                  Accept <Key lit={lit === "accept"}>A</Key>
                </span>
                <span className={cn("inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 transition-colors", lit === "reject" ? "border-[#ff8a7a] bg-[#fdeeeb]" : "border-[#e6e8eb]")}>
                  Reject <Key lit={lit === "reject"}>R</Key>
                </span>
                <span className={cn("inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-[#5c626b] transition-colors", lit === "J" ? "border-[#8fb4ff] bg-[#eef3ff]" : "border-[#e6e8eb]")}>
                  Next moment <Key lit={lit === "J"}>J</Key>
                </span>
                <span className={cn("inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-[#5c626b] transition-colors", lit === "Enter" ? "border-[#8fb4ff] bg-[#eef3ff]" : "border-[#e6e8eb]")}>
                  Replay <Key lit={lit === "Enter"}>↵</Key>
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
