import { ArrowRight, CircleCheck, FileChartColumn, FolderUp, Ghost, Target } from "lucide-react";
import { ButtonLink, Example, ICON } from "../primitives";

const DAYS = [
  { day: "Day 0", icon: Target, title: "Agree on success", text: "We write down what a good result means for you before anything runs." },
  { day: "Day 0", icon: FolderUp, title: "Send about 50 videos", text: "Videos your reviewers already judged, with their decisions and the lab’s spec." },
  { day: "Day 0–2", icon: Ghost, title: "Shadow mode", text: "Ormes decides each video next to your reviewers. No integration, nothing changes for your team." },
  { day: "Day 2", icon: FileChartColumn, title: "Report in 48 h", text: "Where Ormes agreed, where it didn’t, and the review hours it would have saved." },
];

const CRITERIA = ["Review minutes down 40% or more", "No more false accepts than today", "Every reject comes with a reason your reviewers agree with"];

/** Home §8, "How do I try it?": the free pilot as a two-day track, with example success criteria. */
export function FreePilot() {
  return (
    <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
      <ol className="relative flex flex-col gap-6 rounded-[22px] border border-hairline bg-panel p-5 sm:p-7">
        <span aria-hidden className="absolute bottom-10 left-[39px] top-10 w-px bg-[linear-gradient(180deg,var(--color-brand),var(--color-hairline))] sm:left-[47px]" />
        {DAYS.map(({ day, icon: Icon, title, text }) => (
          <li key={title} className="relative flex gap-4">
            <span className="relative z-10 inline-flex size-10 shrink-0 items-center justify-center rounded-full border border-brand/40 bg-background text-brand">
              <Icon {...ICON} className="size-[18px]" />
            </span>
            <div className="pt-0.5">
              <p className="flex flex-wrap items-baseline gap-x-2.5">
                <span className="text-[16.5px] font-medium">{title}</span>
                <span className="font-mono text-[12px] text-muted-foreground">{day}</span>
              </p>
              <p className="mt-1 text-[14.5px] leading-relaxed text-muted-foreground">{text}</p>
            </div>
          </li>
        ))}
      </ol>
      <div className="flex flex-col rounded-[22px] border border-hairline bg-panel p-5 sm:p-7">
        <div className="flex items-center justify-between gap-3">
          <p className="text-[16px] font-medium">Success criteria</p>
          <Example />
        </div>
        <ul className="mt-4 flex flex-col gap-3">
          {CRITERIA.map((c) => (
            <li key={c} className="flex gap-2.5 text-[14.5px]">
              <CircleCheck {...ICON} className="mt-0.5 size-4 shrink-0 text-ok" />
              {c}
            </li>
          ))}
        </ul>
        <p className="mt-5 text-[13.5px] leading-relaxed text-muted-foreground">The pilot is free and needs no integration. You set the criteria with us; the report measures against them.</p>
        <div className="mt-auto pt-8">
          <ButtonLink href="/signup">
            Start a free pilot <ArrowRight {...ICON} className="size-4" />
          </ButtonLink>
        </div>
      </div>
    </div>
  );
}
