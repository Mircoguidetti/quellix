import type { LucideIcon } from "lucide-react";
import { Eye, Hourglass, UsersRound } from "lucide-react";
import { cn } from "@/lib/utils";
import { Example, ICON } from "../primitives";

/**
 * Home §2, "Do you understand my problem?": one example working day, as it ends. Uploads kept
 * landing, one reviewer watched at 3 minutes a video, and most of the day is still waiting.
 * Example numbers: 60 uploads an hour, one reviewer at 20 an hour, an 8-hour day. Static (issue #85).
 */

const SLOTS = 96; // each tile stands for 5 videos
const PER_TILE = 5;
const UPLOADED = 480;
const WATCHED = 160;

const PAINS: { icon: LucideIcon; text: React.ReactNode }[] = [
  { icon: Eye, text: <>Every video is watched by a person, about 3 minutes each.</> },
  { icon: UsersRound, text: <>Each reviewer reads the lab’s spec their own way.</> },
  {
    icon: Hourglass,
    text: (
      <>
        Contributors wait days to hear back, and a rejected take is unpaid.<sup className="ml-0.5 text-muted-foreground">1</sup>
      </>
    ),
  },
];

function Backlog() {
  const watchedTiles = WATCHED / PER_TILE;
  return (
    <div
      className="rounded-[20px] border border-hairline bg-panel p-4 sm:p-6"
      role="img"
      aria-label="Example working day: 480 videos uploaded, 160 watched by one reviewer, 320 still waiting at 17:00"
    >
      <div aria-hidden className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <span className="relative inline-block size-10 rounded-full border border-foreground/25">
            <span className="absolute left-1/2 top-1/2 h-[14px] w-px origin-bottom bg-no" style={{ transform: "translate(-50%, -100%) rotate(150deg)" }} />
            <span className="absolute left-1/2 top-1/2 size-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-foreground" />
          </span>
          <div>
            <p className="tabular font-mono text-[17px] leading-none">17:00</p>
            <p className="mt-1 text-[12.5px] text-muted-foreground">One reviewer, 3 min a video</p>
          </div>
        </div>
        <Example>Example day</Example>
      </div>

      <div aria-hidden className="mt-4 grid grid-cols-16 gap-1 sm:mt-5 sm:grid-cols-12 sm:gap-1.5">
        {Array.from({ length: SLOTS }, (_, i) => (
          <span
            key={i}
            className={cn("aspect-video rounded-[2px] sm:rounded-[3px]", i < watchedTiles ? "bg-ok/30" : "bg-foreground/[0.16]")}
          />
        ))}
      </div>

      <dl aria-hidden className="mt-4 grid grid-cols-3 gap-3 border-t border-hairline pt-3 sm:mt-5 sm:pt-4">
        <div>
          <dt className="text-[12.5px] text-muted-foreground">Uploaded</dt>
          <dd className="tabular font-mono text-[18px] sm:text-[20px]">{UPLOADED}</dd>
        </div>
        <div>
          <dt className="inline-flex items-center gap-1.5 text-[12.5px] text-muted-foreground">
            <i className="size-2 rounded-[2px] bg-ok/50" /> Watched
          </dt>
          <dd className="tabular font-mono text-[18px] sm:text-[20px]">{WATCHED}</dd>
        </div>
        <div>
          <dt className="inline-flex items-center gap-1.5 text-[12.5px] text-muted-foreground">
            <i className="size-2 rounded-[2px] bg-foreground/30" /> Waiting
          </dt>
          <dd className="tabular font-mono text-[18px] text-no sm:text-[20px]">{UPLOADED - WATCHED}</dd>
        </div>
      </dl>
    </div>
  );
}

/** Home §2: the collector's problem in three lines, next to one example day's queue. */
export function Problem() {
  return (
    <div className="grid items-center gap-8 lg:grid-cols-[1fr_1fr] lg:gap-14">
      <div>
        <ul className="flex flex-col gap-3 sm:gap-4">
          {PAINS.map(({ icon: Icon, text }, i) => (
            <li key={i} className="flex gap-3 text-[16px] leading-snug sm:text-[17px]">
              <Icon {...ICON} className="mt-0.5 size-[18px] shrink-0 text-no" />
              <span>{text}</span>
            </li>
          ))}
        </ul>
        <p className="mt-5 text-[12px] leading-relaxed text-muted-foreground">
          1. Feedback after about 3 days:{" "}
          <a
            className="underline decoration-foreground/25 underline-offset-2 hover:text-foreground"
            href="https://www.market-xcel.com/success-stories/first-person-household-video-dataset-collection"
            rel="noopener noreferrer"
            target="_blank"
          >
            Market Xcel, first-person video collection case study
          </a>
          .
        </p>
      </div>
      <Backlog />
    </div>
  );
}
