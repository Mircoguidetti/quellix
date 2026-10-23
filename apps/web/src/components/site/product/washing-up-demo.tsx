"use client";

import type { LucideIcon } from "lucide-react";
import { CalendarClock, CircleCheck, Clock, ScanLine, UserRoundSearch, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { CLIP_BASE, ClipPlayer, useClips, type ClipSidecar } from "../clip-player";
import { SITE_CLIPS } from "../clips";
import { ICON } from "../primitives";

/**
 * Product's washing-up demonstration (issue #85, moved from Home): one real Pexels video and two
 * copies with a defect added, each with the worker's output as it is in its sidecar. Two sections:
 * the three outcomes side by side, then "Today vs With Ormes" on the rejected copy. Static: the
 * videos play, nothing else moves.
 */

type Outcome = "accept" | "review" | "reject";

const CARDS: { outcome: Outcome; label: string }[] = [
  { outcome: "accept", label: "Original" },
  { outcome: "review", label: "Copy: right hand leaves for 3 s" },
  { outcome: "reject", label: "Copy: too dark for 3 s" },
];

const LOOK: Record<Outcome, { icon: LucideIcon; text: string; chip: string; bar: string }> = {
  accept: { icon: CircleCheck, text: "text-ok", chip: "bg-ok/10 text-ok", bar: "bg-ok" },
  review: { icon: UserRoundSearch, text: "text-brand", chip: "bg-brand/10 text-brand", bar: "bg-brand" },
  reject: { icon: XCircle, text: "text-no", chip: "bg-no/10 text-no", bar: "bg-no" },
};

const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

function reasonOf(side: ClipSidecar | null) {
  const r = side?.decision?.reasons[0];
  if (!r) return { text: "No reasons: every check passed", segment: null, hint: null };
  return { text: r.message, segment: r.segments?.[0] ?? null, hint: r.hint ?? null };
}

function Player({ id, side, boxes, className }: { id: string; side: ClipSidecar | null; boxes: boolean; className?: string }) {
  return (
    <div className={cn("relative aspect-video overflow-hidden rounded-xl border border-hairline bg-black", className)}>
      {/* eslint-disable-next-line @next/next/no-img-element -- a plain poster, served as is */}
      <img src={`${CLIP_BASE}/${id}.jpg`} alt="" loading="lazy" className="absolute inset-0 size-full object-cover" />
      {side ? <ClipPlayer key={side.id} side={side} overlay={boxes} /> : null}
    </div>
  );
}

function useWashingUp() {
  const clips = useClips([SITE_CLIPS.why.accept, SITE_CLIPS.why.review, SITE_CLIPS.why.reject]);
  return (outcome: Outcome) => {
    const id = SITE_CLIPS.why[outcome];
    const raw = clips[id];
    const side = raw && raw !== "missing" ? raw : null;
    // The outcome shown is always the worker's; the slot only says which clip to play.
    return { id, side, outcome: (side?.decision?.decision ?? outcome) as Outcome };
  };
}

/** Product §Demo: the same washing-up video three ways, so all three outcomes appear. */
export function ThreeOutcomes() {
  const clip = useWashingUp();
  return (
    <ul className="grid gap-3 md:grid-cols-3 md:gap-4" aria-label="Three versions of the same video">
      {CARDS.map((c) => {
        const { id, side, outcome } = clip(c.outcome);
        const r = reasonOf(side);
        const L = LOOK[outcome];
        return (
          <li key={c.outcome} className="flex items-start gap-3 rounded-2xl border border-hairline bg-panel p-3 md:flex-col md:p-4">
            <Player id={id} side={side} boxes className="w-32 shrink-0 md:w-full" />
            <div className="min-w-0">
              <p className="flex flex-wrap items-center gap-2 text-[14px] font-medium md:text-[15px]">
                {c.label}
                <span className={cn("inline-flex items-center gap-1 rounded-md px-1.5 font-mono text-[12.5px] font-normal", L.chip)}>
                  <L.icon {...ICON} className="size-3.5" />
                  {outcome}
                </span>
              </p>
              <p className="mt-1 text-[13px] leading-snug text-muted-foreground md:text-[14px]">
                {r.text}
                {r.segment ? ` · ${clock(r.segment.start_s)}–${clock(r.segment.end_s)}` : ""}
              </p>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/** Product §Compare: the rejected copy, as a reviewer handles it today and as Ormes does. */
export function TodayVsOrmes() {
  const { id, side, outcome } = useWashingUp()("reject");
  const reason = reasonOf(side);
  const look = LOOK[outcome];
  const duration = side?.video.duration_s ?? 8.5;
  const segments = side?.decision?.reasons.flatMap((r) => r.segments ?? []) ?? [];
  const at = reason.segment ? `, pinned to ${clock(reason.segment.start_s)}` : "";

  return (
    <div className="grid grid-cols-2 gap-3 sm:gap-4">
      <figure className="flex flex-col rounded-[20px] border border-hairline bg-panel p-3 sm:p-5">
        <figcaption className="mb-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
          <span className="inline-flex items-center gap-2 text-[15px] font-medium sm:text-[16px]">
            <Clock {...ICON} className="size-[18px] text-muted-foreground" /> Today
          </span>
          <span className="tabular font-mono text-[12px] text-muted-foreground sm:text-[13px]">watched 3:00</span>
        </figcaption>
        <Player id={id} side={side} boxes={false} />
        <div className="mt-3 h-1 overflow-hidden rounded-full bg-foreground/[0.06]">
          <span className="block h-full w-full rounded-full bg-foreground/35" />
        </div>
        <p className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13.5px] sm:text-[14.5px]">
          <CalendarClock {...ICON} className="size-4 text-muted-foreground" />
          Decision: <b className="font-medium">tomorrow</b>
          <span className="text-muted-foreground">· no reason</span>
        </p>
        <p className="mt-2 text-[13px] text-muted-foreground sm:text-[14px]">The contributor hears: “Your video was rejected.”</p>
      </figure>

      <figure className="flex flex-col rounded-[20px] border border-brand/30 bg-panel p-3 sm:p-5">
        <figcaption className="mb-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
          <span className="inline-flex items-center gap-2 text-[15px] font-medium sm:text-[16px]">
            <ScanLine {...ICON} className="size-[18px] text-brand" /> With Ormes
          </span>
          <span className="font-mono text-[12px] text-brand sm:text-[13px]">in seconds</span>
        </figcaption>
        <Player id={id} side={side} boxes />
        <div className="relative mt-3 h-1 rounded-full bg-foreground/[0.06]">
          {segments.map((s) => (
            <i
              key={`${s.start_s}-${s.end_s}`}
              className={cn("absolute -top-0.5 h-2 rounded-full", look.bar)}
              style={{ left: `${(s.start_s / duration) * 100}%`, width: `${Math.max(1.5, ((s.end_s - s.start_s) / duration) * 100)}%` }}
            />
          ))}
        </div>
        <p className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13.5px] sm:text-[14.5px]">
          <span className={cn("rounded-md px-1.5 font-mono text-[12.5px]", look.chip)}>{outcome}</span>
          <span>{reason.text}</span>
          {reason.segment ? (
            <span className="font-mono text-[12.5px] text-muted-foreground">
              · {clock(reason.segment.start_s)}–{clock(reason.segment.end_s)}
            </span>
          ) : null}
        </p>
        {reason.hint ? (
          <p className="mt-2 text-[13px] text-muted-foreground sm:text-[14px]">
            The contributor hears{at}: “{reason.hint}”
          </p>
        ) : null}
      </figure>
    </div>
  );
}
