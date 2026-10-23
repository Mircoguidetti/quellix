import { ArrowRight, CircleCheck, FileChartColumn, FolderUp, Ghost, Target } from "lucide-react";
import { ButtonLink, Example, ICON } from "../primitives";

const DAYS = [
  { day: "Day 0", icon: Target, title: "Agree on success", text: "What a good result means for you, written down first." },
  { day: "Day 0", icon: FolderUp, title: "Send about 50 videos", text: "Already judged by your reviewers, with the lab’s spec." },
  { day: "Day 0–2", icon: Ghost, title: "Shadow mode", text: "Ormes decides next to your reviewers. No integration." },
  { day: "Day 2", icon: FileChartColumn, title: "Report in 48 h", text: "Where it agreed, where it didn’t, the hours it saves." },
];

const CRITERIA = ["Review minutes down 40% or more", "No more false accepts than today", "Every reject has a reason your reviewers agree with"];

/** Home §8, "How do I try it?": the four steps, then the example success criteria and the CTA. */
export function FreePilot() {
  return (
    <div className="grid gap-4 lg:grid-cols-[1.5fr_1fr] lg:gap-6">
      <ol className="grid gap-x-6 gap-y-4 sm:grid-cols-2 sm:gap-y-6">
        {DAYS.map(({ day, icon: Icon, title, text }) => (
          <li key={title} className="flex gap-3">
            <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-full border border-brand/40 text-brand sm:size-10">
              <Icon {...ICON} className="size-[18px]" />
            </span>
            <div>
              <p className="flex flex-wrap items-baseline gap-x-2">
                <span className="text-[15.5px] font-medium sm:text-[16.5px]">{title}</span>
                <span className="font-mono text-[12px] text-muted-foreground">{day}</span>
              </p>
              <p className="mt-0.5 text-[14px] leading-snug text-muted-foreground">{text}</p>
            </div>
          </li>
        ))}
      </ol>
      <div className="flex flex-col rounded-[20px] border border-hairline bg-panel p-4 sm:p-6">
        <div className="flex items-center justify-between gap-3">
          <p className="text-[15.5px] font-medium">Success criteria</p>
          <Example />
        </div>
        <ul className="mt-3 flex flex-col gap-2">
          {CRITERIA.map((c) => (
            <li key={c} className="flex gap-2.5 text-[14px] leading-snug">
              <CircleCheck {...ICON} className="mt-0.5 size-4 shrink-0 text-ok" />
              {c}
            </li>
          ))}
        </ul>
        <div className="mt-4 pt-1 sm:mt-auto sm:pt-6">
          <ButtonLink href="/signup">
            Start a free pilot <ArrowRight {...ICON} className="size-4" />
          </ButtonLink>
        </div>
      </div>
    </div>
  );
}
