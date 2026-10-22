"use client";

import { useEffect, useRef, useState } from "react";
import { BellRing, CalendarClock, Clock, LoaderCircle, ScanLine, Video, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { ClipPlayer, useClip, type ClipSidecar } from "../clip-player";
import { SITE_CLIPS } from "../clips";
import { Example, ICON, MoreLink } from "../primitives";
import { usePlayback } from "../use-playback";

/**
 * Home §5, "Why aren't my reviewers enough?": the same video, side by side, in sync. Today a person
 * watches it for three minutes and the verdict arrives tomorrow with no reason. With Ormes the
 * decision and its reason arrive in seconds, pinned to the moment, and the contributor gets a fix.
 *
 * With a real clip (SITE_CLIPS.why, a clip whose real decision is a reject) both sides play it and
 * the reason comes from its sidecar; until then a drawn example scene plays.
 */

const CYCLE = 12_000;
const T = {
  decided: 1300, // Ormes decision on screen
  hint: 3400, // contributor receives the fix
  watched: 7000, // reviewer reaches 3:00
  tomorrow: 7400,
  rejected: 9200, // contributor hears back, no reason
};
const VIDEO_S = 164; // the example video is 2:44 long

const EXAMPLE = {
  verdict: "reject" as const,
  reason: "Right hand out of frame",
  segment: { start_s: 41, end_s: 52 },
  hint: "Hold the phone lower and record again.",
};

const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
const smooth = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));

/** Drawn stand-in for the clip: two hands over a counter; the right one drifts out of frame. */
function Scene({ t, boxes }: { t: number; boxes: boolean }) {
  const s = (t % 6000) / 6000;
  // 0 in frame, 1 out of frame; the scene covers 0:30–1:00, so this is 0:41–0:52.
  const out = smooth((s - 0.355) / 0.05) - smooth((s - 0.69) / 0.05);
  const lx = 30 + 4 * Math.sin(s * Math.PI * 4);
  const ly = 58 + 3 * Math.cos(s * Math.PI * 4);
  const rx = 63 + 3 * Math.sin(s * Math.PI * 4 + 1) + 31 * out; // half the hand past the edge: cut, not gone
  const ry = 60 + 3 * Math.cos(s * Math.PI * 4 + 1) + 8 * out;
  const cut = rx + 9 > 100;
  return (
    <div className="absolute inset-0 overflow-hidden bg-[linear-gradient(170deg,#2b2f37,#16191e_55%,#1d2128)]" aria-hidden="true">
      <div className="absolute inset-x-[-5%] bottom-0 h-[42%] rounded-t-[40%] bg-white/[0.06]" />
      <div className="absolute bottom-[16%] left-[40%] h-[16%] w-[22%] rounded-[50%] border border-white/15 bg-white/[0.07]" />
      {[
        { x: lx, y: ly, key: "l" },
        { x: rx, y: ry, key: "r" },
      ].map((h) => (
        <span key={h.key} className="absolute h-[22%] w-[13%] -translate-x-1/2 -translate-y-1/2 rounded-[45%] bg-[#c9a68a]/40" style={{ left: `${h.x}%`, top: `${h.y}%` }} />
      ))}
      {boxes ? (
        <>
          <span className="absolute -translate-x-1/2 -translate-y-1/2 border-[1.5px] border-ok" style={{ left: `${lx}%`, top: `${ly}%`, width: "17%", height: "28%" }} />
          {rx < 104 ? (
            <span
              className={cn("absolute -translate-y-1/2 border-[1.5px]", cut ? "border-no" : "border-ok")}
              style={{ left: `${rx - 8.5}%`, top: `${ry}%`, width: `${Math.min(17, 100 - (rx - 8.5))}%`, height: "28%" }}
            />
          ) : null}
          {cut ? <span className="absolute right-2 top-[30%] rounded bg-no px-1.5 py-0.5 font-mono text-[10px] text-black">right hand · cut</span> : null}
        </>
      ) : null}
    </div>
  );
}

function Player({ t, boxes, side }: { t: number; boxes: boolean; side: ClipSidecar | null }) {
  const at = 30 + ((t % 6000) / 6000) * 30; // the example scene covers 0:30–1:00
  return (
    <div className="relative aspect-video overflow-hidden rounded-xl border border-white/10 bg-black">
      {side ? <ClipPlayer side={side} overlay={boxes} /> : <Scene t={t} boxes={boxes} />}
      {!side ? <span className="absolute bottom-2 left-2 rounded bg-black/60 px-1.5 font-mono text-[10.5px] text-white/75">{clock(at)} / 2:44</span> : null}
    </div>
  );
}

/** The top of a contributor's phone with one notification. */
function PhoneBanner({ show, tone, title, body, action }: { show: boolean; tone: "plain" | "fix"; title: string; body?: string; action?: string }) {
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
          <p className={cn("mt-1 text-[13.5px] font-medium", tone === "plain" ? "text-[#0b0c0e]" : "text-[#b5321f]")}>{title}</p>
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

export function WhyOrmes() {
  const ref = useRef<HTMLDivElement>(null);
  const playing = usePlayback(ref);
  const [tick, setTick] = useState(0);
  const clip = useClip(SITE_CLIPS.why);
  const side = clip && clip !== "missing" && clip.decision?.decision === "reject" && clip.decision.reasons.length > 0 ? clip : null;

  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    const start = performance.now();
    const loop = (now: number) => {
      setTick((now - start) % CYCLE);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [playing]);

  // At rest the scene shows its end state: both stories told.
  const t = playing ? tick : CYCLE - 1;
  // The still frame shows the moment that matters: the right hand cut by the edge.
  const sceneT = playing ? tick : 3000;
  const reason = side ? side.decision!.reasons[0] : null;
  const verdict = {
    text: reason ? reason.message : EXAMPLE.reason,
    segment: reason?.segments?.[0] ?? (side ? null : EXAMPLE.segment),
    hint: reason ? (reason.hint ?? null) : EXAMPLE.hint,
  };
  const duration = side?.video.duration_s ?? VIDEO_S;
  const watching = Math.min(180, (t / T.watched) * 180);

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
          <Player t={sceneT} boxes={false} side={side} />
          <div className="mt-3 h-1 overflow-hidden rounded-full bg-white/[0.06]">
            <span className="block h-full rounded-full bg-white/40" style={{ width: `${(watching / 180) * 100}%` }} />
          </div>
          <p className={cn("mt-4 flex items-center gap-2 text-[14.5px] transition-opacity duration-500", t >= T.tomorrow ? "opacity-100" : "opacity-0")}>
            <CalendarClock {...ICON} className="size-4 text-muted-foreground" />
            Decision: <b className="font-medium">tomorrow</b>
            <span className="hidden text-muted-foreground sm:inline">· after a person watches every minute</span>
          </p>
          <PhoneBanner show={t >= T.rejected} tone="plain" title="Your video was rejected." />
        </figure>

        {/* With Ormes */}
        <figure className="flex flex-col rounded-[22px] border border-brand/30 bg-[linear-gradient(180deg,rgba(143,180,255,0.06),transparent_40%)] p-4 sm:p-5">
          <figcaption className="mb-3 flex items-center justify-between">
            <span className="inline-flex items-center gap-2 text-[16px] font-medium">
              <ScanLine {...ICON} className="size-[18px] text-brand" /> With Ormes
            </span>
            <span className="tabular font-mono text-[13px] text-brand">{t >= T.decided ? (side ? "decided in seconds" : "decided in 0:28") : "analysing…"}</span>
          </figcaption>
          <Player t={sceneT} boxes side={side} />
          <div className="relative mt-3 h-1 rounded-full bg-white/[0.06]">
            {verdict.segment ? (
              <i
                className={cn("absolute -top-0.5 h-2 rounded-full bg-no transition-opacity duration-500", t >= T.decided ? "opacity-100" : "opacity-0")}
                style={{ left: `${(verdict.segment.start_s / duration) * 100}%`, width: `${Math.max(1.5, ((verdict.segment.end_s - verdict.segment.start_s) / duration) * 100)}%` }}
              />
            ) : null}
          </div>
          <div className="mt-4 min-h-[22px] text-[14.5px]">
            {t >= T.decided ? (
              <p className="flex flex-wrap items-center gap-2 motion-safe:animate-in motion-safe:fade-in">
                <XCircle {...ICON} className="size-4 text-no" />
                <span className="rounded-md bg-no/12 px-1.5 font-mono text-[13px] text-no">reject</span>
                {verdict.text}
                {verdict.segment ? (
                  <span className="font-mono text-[13px] text-muted-foreground">
                    · {clock(verdict.segment.start_s)}–{clock(verdict.segment.end_s)}
                  </span>
                ) : null}
              </p>
            ) : (
              <p className="flex items-center gap-2 text-muted-foreground">
                <LoaderCircle {...ICON} className="size-4 motion-safe:animate-spin" /> Checking hands, steps, privacy…
              </p>
            )}
          </div>
          <PhoneBanner
            show={t >= T.hint && !!verdict.hint}
            tone="fix"
            title={`${verdict.text}${verdict.segment ? ` at ${clock(verdict.segment.start_s)}` : ""}.`}
            body={verdict.hint ?? undefined}
            action="Record again"
          />
        </figure>
      </div>
      <div className="mt-6 flex flex-wrap items-center justify-between gap-4">
        <p className="flex items-center gap-2 text-[13px] text-muted-foreground">
          {side ? null : <Example>Example video</Example>}
          Same video, same spec. Doubtful cases still go to a person.
        </p>
        <MoreLink href="/product">How it works</MoreLink>
      </div>
    </div>
  );
}
