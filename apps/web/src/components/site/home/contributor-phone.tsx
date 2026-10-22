"use client";

import { useRef } from "react";
import { CheckCircle2, FileVideo, LoaderCircle, MessageSquareText, Smartphone, Timer, TriangleAlert, Video } from "lucide-react";
import { cn } from "@/lib/utils";
import { ICON, Soon } from "../primitives";
import { usePlayback } from "../use-playback";
import s from "./home.module.css";

const POINTS = [
  {
    icon: MessageSquareText,
    title: "Right after upload",
    text: "Every decision carries its reasons and their times, ready to show in your contributor app.",
  },
  {
    icon: Smartphone,
    title: "While recording",
    soon: true,
    text: "Live coaching on the phone when a hand leaves the frame or the light drops, so the bad take never happens.",
  },
  {
    icon: Timer,
    title: "Before the task",
    soon: true,
    text: "A five-second test shot checks camera position and light before twenty minutes are recorded.",
  },
];

function Phone() {
  const ref = useRef<HTMLDivElement>(null);
  const playing = usePlayback(ref);
  return (
    <div ref={ref} data-play={playing ? "" : undefined} className="relative mx-auto w-[min(300px,100%)]" role="img" aria-label="A contributor's phone after an upload: the video was not accepted, the right hand left the frame from 0:41 to 0:52, with a Record again button">
      <div aria-hidden className="absolute -inset-10 rounded-full bg-[radial-gradient(closest-side,rgba(255,138,122,0.12),transparent)]" />
      <div aria-hidden="true" className="relative aspect-[9/19] rounded-[46px] border border-white/15 bg-[#16181c] p-[9px] shadow-[0_50px_100px_-30px_rgba(0,0,0,0.9)]">
        <div className="relative flex h-full flex-col overflow-hidden rounded-[38px] bg-[#f4f5f7] text-[#0b0c0e]">
          <div className="flex items-center justify-between px-6 pb-1 pt-3 text-[12px] font-medium">
            <span>9:41</span>
            <span className="h-[22px] w-[84px] rounded-full bg-black" />
            <span className="tabular">100%</span>
          </div>
          <div className="px-4 pb-3 pt-3">
            <p className="text-[11px] uppercase tracking-[0.08em] text-[#5c626b]">Your task</p>
            <p className="text-[16px] font-medium">Load the dishwasher</p>
          </div>
          <div className="mx-3 rounded-2xl bg-white p-3 shadow-[0_1px_2px_rgba(0,0,0,0.06)]">
            <div className="flex items-center gap-2.5">
              <span className="inline-flex size-9 items-center justify-center rounded-xl bg-[#eef3ff] text-[#2a56b8]">
                <FileVideo {...ICON} className="size-[18px]" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] font-medium">kitchen_0412.mp4</p>
                <p className="flex items-center gap-1 text-[11.5px] text-[#5c626b]">
                  <CheckCircle2 {...ICON} className="size-3 text-[#15703f]" /> Uploaded · 2:44
                </p>
              </div>
            </div>
            <div className="mt-2.5 h-1 overflow-hidden rounded-full bg-[#eef0f3]">
              <span className={cn(s.upload, "block h-full rounded-full bg-[#5b8def]")} />
            </div>
          </div>
          <ul className="mx-3 mt-3 flex flex-col gap-1 rounded-2xl bg-white/70 p-3 text-[12px]">
            <li className="mb-1 text-[11px] uppercase tracking-[0.08em] text-[#5c626b]">Earlier takes</li>
            <li className="flex items-center justify-between">
              <span>kitchen_0409.mp4</span>
              <span className="rounded bg-[#e8f7ef] px-1.5 font-mono text-[10.5px] text-[#15703f]">paid</span>
            </li>
            <li className="flex items-center justify-between">
              <span>kitchen_0402.mp4</span>
              <span className="rounded bg-[#e8f7ef] px-1.5 font-mono text-[10.5px] text-[#15703f]">paid</span>
            </li>
          </ul>
          <p className={cn(s.checking, "mx-4 mt-3 flex items-center gap-2 text-[12.5px] text-[#5c626b]")}>
            <LoaderCircle {...ICON} className="size-3.5 motion-safe:animate-spin" /> Checking your video…
          </p>
          <div className={cn(s.message, "absolute inset-x-3 bottom-3 rounded-[26px] bg-white p-4 shadow-[0_20px_40px_-12px_rgba(0,0,0,0.3)]")}>
            <span className="inline-flex size-9 items-center justify-center rounded-full bg-[#fdeeeb] text-[#b5321f]">
              <TriangleAlert {...ICON} className="size-[18px]" />
            </span>
            <p className="mt-3 text-[15px] font-medium leading-snug">Right hand left the frame <span className="whitespace-nowrap">0:41–0:52.</span></p>
            <p className="mt-1 text-[13px] leading-snug text-[#5c626b]">Hold the phone lower and record again.</p>
            <div className="relative mt-3 h-1.5 rounded-full bg-[#eef0f3]">
              <i className="absolute inset-y-0 rounded-full bg-[#ff8a7a]" style={{ left: "25%", width: "7%" }} />
            </div>
            <div className="mt-1 flex justify-between font-mono text-[10px] text-[#5c626b]">
              <span>0:00</span>
              <span>2:44</span>
            </div>
            <span className="mt-4 flex h-11 items-center justify-center gap-2 rounded-full bg-[#0b0c0e] text-[14px] font-medium text-white">
              <Video {...ICON} className="size-4" /> Record again
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Home §5: what the contributor sees, so the next take is right. */
export function ContributorFeedback() {
  return (
    <div className="grid items-center gap-14 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <Phone />
      <ul className="flex flex-col divide-y divide-hairline border-y border-hairline">
        {POINTS.map(({ icon: Icon, title, text, soon }) => (
          <li key={title} className="flex gap-4 py-6">
            <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-xl bg-white/[0.06] text-foreground">
              <Icon {...ICON} className="size-5" />
            </span>
            <div>
              <h3 className="flex items-center gap-2 text-[17px] font-medium">
                {title}
                {soon ? <Soon /> : null}
              </h3>
              <p className="mt-1 text-[15px] leading-relaxed text-muted-foreground">{text}</p>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
