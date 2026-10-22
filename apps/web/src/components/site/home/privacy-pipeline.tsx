"use client";

import { useRef } from "react";
import { ArrowRight, Cpu, FileVideo, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { ICON } from "../primitives";
import { usePlayback } from "../use-playback";
import s from "./home.module.css";

/**
 * Home §6: a video goes in, is analysed, and dissolves; the decision card stays.
 */
export function PrivacyPipeline() {
  const ref = useRef<HTMLDivElement>(null);
  const playing = usePlayback(ref);
  return (
    <div ref={ref} data-play={playing ? "" : undefined}>
      <div
        role="img"
        aria-label="A video file is analysed, then deleted; only the decision with its reasons and measurements is kept"
        className="grid items-center gap-4 rounded-[22px] border border-hairline bg-[radial-gradient(ellipse_at_50%_0%,rgba(143,180,255,0.08),transparent_60%)] p-5 sm:p-8 md:grid-cols-[1fr_auto_1fr_auto_1.2fr]"
      >
        <div aria-hidden className="relative">
          <div className={cn(s.file, "flex items-center gap-3 rounded-2xl border border-white/15 bg-panel-2 p-4")}>
            <span className="inline-flex size-11 items-center justify-center rounded-xl bg-white/[0.06]">
              <FileVideo {...ICON} className="size-5" />
            </span>
            <div>
              <p className="font-mono text-[13px]">v_88214.mp4</p>
              <p className="font-mono text-[11.5px] text-muted-foreground">412 MB · 02:44</p>
            </div>
          </div>
          <span className={cn(s.fileGone, "absolute -bottom-3 left-4 inline-flex items-center gap-1.5 rounded-full border border-hairline bg-black px-2.5 py-0.5 font-mono text-[11px] text-muted-foreground")}>
            <Trash2 {...ICON} className="size-3" /> deleted after analysis
          </span>
        </div>
        <ArrowRight aria-hidden strokeWidth={1.5} className="mx-auto size-5 rotate-90 text-muted-foreground md:rotate-0" />
        <div aria-hidden className="relative mx-auto flex h-28 w-full max-w-[220px] flex-col items-center justify-center gap-2 overflow-hidden rounded-2xl border border-brand/40 bg-brand/[0.06]">
          <span className={cn(s.scan, "absolute inset-x-0 top-1/2 h-px bg-brand shadow-[0_0_16px_2px_rgba(143,180,255,0.6)]")} />
          <Cpu {...ICON} className="size-6 text-brand" />
          <span className="text-[14px]">Analysed once</span>
        </div>
        <ArrowRight aria-hidden strokeWidth={1.5} className="mx-auto size-5 rotate-90 text-muted-foreground md:rotate-0" />
        <div aria-hidden className={cn(s.card, "rounded-2xl border border-white/15 bg-white p-4 text-[#0b0c0e]")}>
          <div className="flex items-center justify-between">
            <span className="font-mono text-[12.5px] text-[#5c626b]">v_88214</span>
            <span className="rounded bg-[#e8f7ef] px-1.5 font-mono text-[12px] text-[#15703f]">accept</span>
          </div>
          <ul className="mt-3 flex flex-col gap-1.5 font-mono text-[11.5px] text-[#5c626b]">
            <li className="flex justify-between">
              <span>hands_visible</span>
              <span className="text-[#0b0c0e]">0.92</span>
            </li>
            <li className="flex justify-between">
              <span>task_completed</span>
              <span className="text-[#0b0c0e]">3/3</span>
            </li>
            <li className="flex justify-between">
              <span>rubric</span>
              <span className="text-[#0b0c0e]">v3</span>
            </li>
          </ul>
          <p className="mt-3 border-t border-[#e6e8eb] pt-2 text-[12px] text-[#5c626b]">Kept: decision, reasons, measurements</p>
        </div>
      </div>
    </div>
  );
}
