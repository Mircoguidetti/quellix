"use client";

import { useEffect, useRef, useState } from "react";
import type { LucideIcon } from "lucide-react";
import { BellRing, CalendarClock, CircleCheck, Clock, LoaderCircle, ScanLine, UserRoundSearch, Video, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { CLIP_BASE, ClipPlayer, useClips, type ClipSidecar } from "../clip-player";
import { SITE_CLIPS } from "../clips";
import { ICON, MoreLink } from "../primitives";
import { usePlayback } from "../use-playback";

/**
 * Home §5, "Why aren't my reviewers enough?": the same video, side by side. Today a person watches
 * it for three minutes and the verdict arrives tomorrow with no reason. With Ormes the decision and
 * its reason arrive in seconds, pinned to the moment, and the contributor knows what to fix.
 *
 * Three real clips (issue #69): the original and two copies with a defect added. Each shows the
 * worker's output as it is, so all three outcomes appear: accept, review and reject.
 */

type Outcome = "accept" | "review" | "reject";

const CYCLE = 12_000;
const T = {
  decided: 1300, // Ormes decision on screen
  hint: 3400, // contributor hears back
  watched: 7000, // reviewer reaches 3:00
  tomorrow: 7400,
  told: 9200, // contributor hears back, no reason
};

/** The cards, left to right. The scene plays them reject first, the one that matters most. */
const CARDS: { outcome: Outcome; label: string }[] = [
  { outcome: "accept", label: "Original" },
  { outcome: "review", label: "Copy: right hand leaves for 3 s" },
  { outcome: "reject", label: "Copy: too dark for 3 s" },
];
const PLAY_ORDER = [2, 1, 0];

const LOOK: Record<Outcome, { icon: LucideIcon; text: string; chip: string; bar: string }> = {
  accept: { icon: CircleCheck, text: "text-ok", chip: "bg-ok/12 text-ok", bar: "bg-ok" },
  review: { icon: UserRoundSearch, text: "text-brand", chip: "bg-brand/12 text-brand", bar: "bg-brand" },
  reject: { icon: XCircle, text: "text-no", chip: "bg-no/12 text-no", bar: "bg-no" },
};

/** What the contributor hears today, a day later and with no reason. */
const TODAY: Record<Outcome, string> = {
  accept: "Your video was accepted.",
  review: "Your video is still in review.",
  reject: "Your video was rejected.",
};

const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

function reasonOf(side: ClipSidecar | null) {
  const r = side?.decision?.reasons[0];
  if (!r) return { text: "No reasons: every check passed", segment: null, hint: null };
  return { text: r.message, segment: r.segments?.[0] ?? null, hint: r.hint ?? null };
}

function Player({ id, side, boxes }: { id: string; side: ClipSidecar | null; boxes: boolean }) {
  return (
    <div className="relative aspect-video overflow-hidden rounded-xl border border-white/10 bg-black">
      {/* eslint-disable-next-line @next/next/no-img-element -- a plain poster, served as is */}
      <img src={`${CLIP_BASE}/${id}.jpg`} alt="" loading="lazy" className="absolute inset-0 size-full object-cover" />
      {side ? <ClipPlayer key={side.id} side={side} overlay={boxes} /> : null}
    </div>
  );
}

/** The top of a contributor's phone with one notification. */
function PhoneBanner({ show, tone, title, body, action }: { show: boolean; tone: "plain" | Outcome; title: string; body?: string; action?: string }) {
  const color = tone === "reject" ? "text-[#b5321f]" : tone === "review" ? "text-[#2a5bc9]" : tone === "accept" ? "text-[#13783f]" : "text-[#0b0c0e]";
  return (
    <div className="relative mt-4 h-[176px] overflow-hidden sm:h-[150px]" aria-hidden={!show}>
      <div className="absolute inset-x-6 top-0 h-[210px] rounded-t-[30px] border border-b-0 border-white/15 bg-[#f4f5f7] px-3 pt-2.5">
        <span className="mx-auto block h-[14px] w-[64px] rounded-full bg-black" />
        {!show ? <p className="mt-6 text-center text-[12px] text-[#5c626b]">No new messages</p> : null}
        <div
          className={cn(
            "absolute inset-x-3 top-[34px] rounded-2xl bg-white p-3 text-[#0b0c0e] shadow-[0_10px_24px_-12px_rgba(0,0,0,0.35)] transition-all duration-500",
            show ? "translate-y-0 opacity-100" : "-translate-y-3 opacity-0",
          )}
        >
          <p className="flex items-center gap-1.5 text-[11px] text-[#5c626b]">
            <BellRing {...ICON} className="size-3" /> Your collector app
          </p>
          <p className={cn("mt-1 text-[13.5px] font-medium", color)}>{title}</p>
          {body ? <p className="text-[12.5px] leading-snug text-[#5c626b]">{body}</p> : null}
          {action ? (
            <span className="mt-2 inline-flex h-7 items-center gap-1.5 rounded-full bg-[#0b0c0e] px-3 text-[12px] font-medium text-white">
              <Video {...ICON} className="size-3.5" /> {action}
            </span>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/** What the contributor hears from Ormes, in seconds. */
function ormesMessage(outcome: Outcome, reason: ReturnType<typeof reasonOf>) {
  const at = reason.segment ? ` at ${clock(reason.segment.start_s)}` : "";
  if (outcome === "reject") return { title: `Rejected${at}: ${reason.text}`, body: reason.hint ?? undefined, action: "Record again" };
  if (outcome === "review") return { title: "A person will check your video.", body: reason.hint ? `Next time: ${reason.hint}` : undefined };
  return { title: "Your video was accepted.", body: "Nothing to fix." };
}

export function WhyOrmes() {
  const ref = useRef<HTMLDivElement>(null);
  const playing = usePlayback(ref);
  const [tick, setTick] = useState(0);
  const [step, setStep] = useState(0);
  const [pinned, setPinned] = useState<number | null>(null);
  const clips = useClips([SITE_CLIPS.why.accept, SITE_CLIPS.why.review, SITE_CLIPS.why.reject]);

  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let start = performance.now();
    const loop = (now: number) => {
      if (now - start >= CYCLE) {
        start = now;
        if (pinned === null) setStep((s) => (s + 1) % PLAY_ORDER.length);
      }
      setTick(now - start);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [playing, pinned]);

  // At rest the scene shows its end state (both stories told) for the reject.
  const t = playing ? tick : CYCLE - 1;
  const index = pinned ?? PLAY_ORDER[playing ? step : 0];
  const card = CARDS[index];
  const id = SITE_CLIPS.why[card.outcome];
  const raw = clips[id];
  const side = raw && raw !== "missing" ? raw : null;
  // The outcome shown is always the worker's; the card's slot only says which clip to play.
  const outcome: Outcome = side?.decision?.decision ?? card.outcome;
  const reason = reasonOf(side);
  const look = LOOK[outcome];
  const duration = side?.video.duration_s ?? 8.5;
  const watching = Math.min(180, (t / T.watched) * 180);
  const segments = side?.decision?.reasons.flatMap((r) => r.segments ?? []) ?? [];
  const msg = ormesMessage(outcome, reason);

  return (
    <div ref={ref}>
      <div className="grid gap-4 lg:grid-cols-2">
        {/* Today */}
        <figure className="flex flex-col rounded-[22px] border border-hairline bg-panel p-4 sm:p-5">
          <figcaption className="mb-3 flex items-center justify-between">
            <span className="inline-flex items-center gap-2 text-[16px] font-medium">
              <Clock {...ICON} className="size-[18px] text-muted-foreground" /> Today
            </span>
            <span className="tabular font-mono text-[13px] text-muted-foreground">watched {clock(watching)}</span>
          </figcaption>
          <Player id={id} side={side} boxes={false} />
          <div className="mt-3 h-1 overflow-hidden rounded-full bg-white/[0.06]">
            <span className="block h-full rounded-full bg-white/40" style={{ width: `${(watching / 180) * 100}%` }} />
          </div>
          <p className={cn("mt-4 flex items-center gap-2 text-[14.5px] transition-opacity duration-500", t >= T.tomorrow ? "opacity-100" : "opacity-0")}>
            <CalendarClock {...ICON} className="size-4 text-muted-foreground" />
            Decision: <b className="font-medium">tomorrow</b>
            <span className="hidden text-muted-foreground sm:inline">· after a person watches every minute</span>
          </p>
          <PhoneBanner show={t >= T.told} tone="plain" title={TODAY[outcome]} />
        </figure>

        {/* With Ormes */}
        <figure className="flex flex-col rounded-[22px] border border-brand/30 bg-[linear-gradient(180deg,rgba(143,180,255,0.06),transparent_40%)] p-4 sm:p-5">
          <figcaption className="mb-3 flex items-center justify-between">
            <span className="inline-flex items-center gap-2 text-[16px] font-medium">
              <ScanLine {...ICON} className="size-[18px] text-brand" /> With Ormes
            </span>
            <span className="tabular font-mono text-[13px] text-brand">{t >= T.decided ? "decided in seconds" : "analysing…"}</span>
          </figcaption>
          <Player id={id} side={side} boxes />
          <div className="relative mt-3 h-1 rounded-full bg-white/[0.06]">
            {segments.map((s) => (
              <i
                key={`${s.start_s}-${s.end_s}`}
                className={cn("absolute -top-0.5 h-2 rounded-full transition-opacity duration-500", look.bar, t >= T.decided ? "opacity-100" : "opacity-0")}
                style={{ left: `${(s.start_s / duration) * 100}%`, width: `${Math.max(1.5, ((s.end_s - s.start_s) / duration) * 100)}%` }}
              />
            ))}
          </div>
          <div className="mt-4 min-h-[44px] text-[14.5px]">
            {t >= T.decided ? (
              <p className="flex flex-wrap items-center gap-2 motion-safe:animate-in motion-safe:fade-in">
                <look.icon {...ICON} className={cn("size-4", look.text)} />
                <span className={cn("rounded-md px-1.5 font-mono text-[13px]", look.chip)}>{outcome}</span>
                {reason.text}
                {reason.segment ? (
                  <span className="font-mono text-[13px] text-muted-foreground">
                    · {clock(reason.segment.start_s)}–{clock(reason.segment.end_s)}
                  </span>
                ) : null}
              </p>
            ) : (
              <p className="flex items-center gap-2 text-muted-foreground">
                <LoaderCircle {...ICON} className="size-4 motion-safe:animate-spin" /> Checking hands, steps, privacy…
              </p>
            )}
          </div>
          <PhoneBanner show={t >= T.hint} tone={outcome} title={msg.title} body={msg.body} action={msg.action} />
        </figure>
      </div>

      {/* The three clips: pick one to play it above. */}
      <ul className="mt-4 grid gap-3 md:grid-cols-3" aria-label="Three versions of the same video">
        {CARDS.map((c, i) => {
          const cid = SITE_CLIPS.why[c.outcome];
          const cs = clips[cid];
          const s = cs && cs !== "missing" ? cs : null;
          const o: Outcome = s?.decision?.decision ?? c.outcome;
          const r = reasonOf(s);
          const L = LOOK[o];
          const on = i === index;
          return (
            <li key={c.outcome}>
              <button
                type="button"
                aria-pressed={on}
                onClick={() => setPinned(i)}
                className={cn(
                  "flex h-full w-full items-start gap-3 rounded-2xl border p-3 text-left transition-colors md:flex-col",
                  on ? "border-foreground/40 bg-foreground/[0.06]" : "border-hairline hover:border-foreground/25",
                )}
              >
                <span className="relative block aspect-video w-28 shrink-0 overflow-hidden rounded-lg border border-white/10 md:w-full">
                              {/* eslint-disable-next-line @next/next/no-img-element -- a plain poster, served as is */}
                              <img src={`${CLIP_BASE}/${cid}.jpg`} alt="" loading="lazy" className="absolute inset-0 size-full object-cover" />
                </span>
                <span className="min-w-0">
                  <span className="flex flex-wrap items-center gap-2 text-[14px] font-medium">
                    {c.label}
                    <span className={cn("rounded-md px-1.5 font-mono text-[12.5px] font-normal", L.chip)}>{o}</span>
                  </span>
                  <span className="mt-1 block text-[13px] leading-snug text-muted-foreground">
                    {r.text}
                    {r.segment ? ` · ${clock(r.segment.start_s)}–${clock(r.segment.end_s)}` : ""}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      <div className="mt-6 flex flex-wrap items-center justify-between gap-4">
        <p className="max-w-[70ch] text-[13px] text-muted-foreground">
          One real video (Pexels) and two copies with a defect added. Decisions and reasons are Ormes’s output, unedited. Doubtful cases go to a
          person.
        </p>
        <MoreLink href="/product">How it works</MoreLink>
      </div>
    </div>
  );
}
