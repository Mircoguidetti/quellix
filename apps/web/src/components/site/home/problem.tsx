"use client";

import { useEffect, useRef, useState } from "react";
import type { LucideIcon } from "lucide-react";
import { Eye, Hourglass, PackageX, UsersRound, VideoOff } from "lucide-react";
import { cn } from "@/lib/utils";
import { Example, ICON } from "../primitives";
import { usePlayback } from "../use-playback";

/**
 * Home §2, "Do you understand my problem?": a working day in fast-forward. Uploads keep landing,
 * one reviewer watches at 3 minutes a video, and the queue of unwatched clips grows.
 * Example numbers: 60 uploads an hour, one reviewer at 20 an hour, an 8-hour day.
 */

const SLOTS = 96; // each tile stands for 5 videos
const PER_TILE = 5;
const UPLOADS_PER_HOUR = 60;
const WATCHED_PER_HOUR = 20; // 3 minutes a video
const HOURS = 8;
const DAY_MS = 9000;
const HOLD_MS = 2200;

const PAINS: { icon: LucideIcon; text: React.ReactNode }[] = [
  { icon: Eye, text: <>Every video is watched by a person, about 3 minutes each, before anyone can pay for it.</> },
  { icon: UsersRound, text: <>Each reviewer reads the lab’s spec their own way, so the same video passes on Monday and fails on Friday.</> },
  {
    icon: Hourglass,
    text: (
      <>
        Contributors wait days to hear back, and a rejected take is unpaid work.<sup className="ml-0.5 text-muted-foreground">1</sup>
      </>
    ),
  },
  {
    icon: VideoOff,
    text: (
      <>
        Without capture controls, 30–40% of footage fails QC.<sup className="ml-0.5 text-muted-foreground">2</sup>
      </>
    ),
  },
  { icon: PackageX, text: <>One bad video that slips through can get a whole batch sent back by the lab.</> },
];

function Backlog() {
  const ref = useRef<HTMLDivElement>(null);
  const playing = usePlayback(ref);
  const [p, setP] = useState(1);

  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let start = performance.now();
    const tick = (now: number) => {
      let t = now - start;
      if (t > DAY_MS + HOLD_MS) {
        start = now;
        t = 0;
      }
      setP(Math.min(1, t / DAY_MS));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing]);

  const progress = playing ? p : 1;
  const hours = progress * HOURS;
  const uploaded = Math.round(hours * UPLOADS_PER_HOUR);
  const watched = Math.round(hours * WATCHED_PER_HOUR);
  const arrivedTiles = Math.round(uploaded / PER_TILE);
  const watchedTiles = Math.round(watched / PER_TILE);
  const clock = 9 + hours;
  const hh = Math.floor(clock);
  const mm = Math.floor((clock - hh) * 60);
  const angle = (clock % 12) * 30;

  return (
    <div ref={ref} className="rounded-[22px] border border-hairline bg-panel p-5 sm:p-6" role="img" aria-label="Example working day: 480 videos uploaded, 160 watched by one reviewer, 320 still waiting at 17:00">
      <div aria-hidden className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <span className="relative inline-block size-11 rounded-full border border-foreground/25">
            <span className="absolute left-1/2 top-1/2 h-[15px] w-px origin-bottom -translate-x-1/2 -translate-y-full bg-no" style={{ transform: `translate(-50%, -100%) rotate(${angle}deg)` }} />
            <span className="absolute left-1/2 top-1/2 size-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white" />
          </span>
          <div>
            <p className="tabular font-mono text-[18px] leading-none">
              {String(hh).padStart(2, "0")}:{String(mm).padStart(2, "0")}
            </p>
            <p className="mt-1 text-[12.5px] text-muted-foreground">One reviewer, 3 min a video</p>
          </div>
        </div>
        <Example>Example day</Example>
      </div>

      <div aria-hidden className="mt-5 grid grid-cols-12 gap-1.5">
        {Array.from({ length: SLOTS }, (_, i) => {
          const state = i < watchedTiles ? "watched" : i < arrivedTiles ? "waiting" : "empty";
          return (
            <span
              key={i}
              className={cn(
                "relative aspect-video rounded-[3px] transition-colors duration-300",
                state === "watched" && "bg-ok/25",
                state === "waiting" && "bg-foreground/[0.16]",
                state === "empty" && "border border-dashed border-foreground/[0.07]",
              )}
            >
              {state === "waiting" ? <i className="absolute left-1/2 top-1/2 -ml-[2px] -mt-[3px] border-y-[3px] border-l-[5px] border-y-transparent border-l-white/40" /> : null}
            </span>
          );
        })}
      </div>

      <dl aria-hidden className="mt-5 grid grid-cols-3 gap-3 border-t border-hairline pt-4">
        <div>
          <dt className="text-[12.5px] text-muted-foreground">Uploaded</dt>
          <dd className="tabular font-mono text-[20px]">{uploaded}</dd>
        </div>
        <div>
          <dt className="inline-flex items-center gap-1.5 text-[12.5px] text-muted-foreground">
            <i className="size-2 rounded-[2px] bg-ok/50" /> Watched
          </dt>
          <dd className="tabular font-mono text-[20px]">{watched}</dd>
        </div>
        <div>
          <dt className="inline-flex items-center gap-1.5 text-[12.5px] text-muted-foreground">
            <i className="size-2 rounded-[2px] bg-foreground/30" /> Waiting
          </dt>
          <dd className="tabular font-mono text-[20px] text-no">{uploaded - watched}</dd>
        </div>
      </dl>
    </div>
  );
}

/** Home §2: the collector's problem, with the backlog visual and sources in small print. */
export function Problem() {
  return (
    <div className="grid items-start gap-10 lg:grid-cols-[1fr_1fr] lg:gap-14">
      <div>
        <ul className="flex flex-col">
          {PAINS.map(({ icon: Icon, text }, i) => (
            <li key={i} className="flex gap-3.5 border-t border-hairline py-4 text-[15.5px] leading-relaxed first:border-t-0 first:pt-0">
              <Icon {...ICON} className="mt-1 size-[18px] shrink-0 text-no" />
              <span>{text}</span>
            </li>
          ))}
        </ul>
        <ol className="mt-6 flex flex-col gap-1 text-[12px] leading-relaxed text-muted-foreground">
          <li>
            1. Feedback after about 3 days:{" "}
            <a className="underline decoration-white/20 underline-offset-2 hover:text-foreground" href="https://www.market-xcel.com/success-stories/first-person-household-video-dataset-collection" rel="noopener noreferrer" target="_blank">
              Market Xcel, first-person video collection case study
            </a>
            .
          </li>
          <li>
            2.{" "}
            <a className="underline decoration-white/20 underline-offset-2 hover:text-foreground" href="https://unidata.pro/blog/egocentric-data-collection-for-robot-training/" rel="noopener noreferrer" target="_blank">
              Unidata, Egocentric data collection for robot training
            </a>
            .
          </li>
        </ol>
      </div>
      <Backlog />
    </div>
  );
}
