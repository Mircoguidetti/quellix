import { BellRing, Clock, ScanLine, Video } from "lucide-react";
import { cn } from "@/lib/utils";
import dark from "../../../../public/media/clips/clip-01-dark.json";
import { ICON, MoreLink } from "../primitives";

/**
 * Home §5, "Why aren't my reviewers enough?" (issue #85: no video). The same rejected video, as the
 * contributor hears about it: today a bare "rejected" the next day; with Ormes, seconds after upload,
 * the moment and what to fix. The reason and hint are the worker's real output for clip-01-dark.
 */

const reason = dark.decision.reasons[0];
const at = reason.segments[0].start_s;
const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
// "Too dark…" reads as the second half of a sentence after "Rejected at 0:02:".
const message = reason.message.charAt(0).toLowerCase() + reason.message.slice(1);

function Phone({ when, title, body, action, tone }: { when: string; title: string; body?: string; action?: string; tone: "plain" | "fix" }) {
  return (
    <div aria-hidden className={cn("relative overflow-hidden sm:h-[190px]", tone === "fix" ? "h-[206px]" : "h-[112px]")}>
      <div className="absolute inset-x-3 top-0 h-[230px] rounded-t-[30px] border border-b-0 border-white/15 bg-[#f4f5f7] px-3 pt-2.5 sm:inset-x-8">
        <span className="mx-auto block h-[14px] w-[64px] rounded-full bg-black" />
        <div className="mt-4 rounded-2xl bg-white p-3 text-[#0b0c0e] shadow-[0_10px_24px_-12px_rgba(0,0,0,0.35)]">
          <p className="flex items-center justify-between gap-2 text-[11px] text-[#5c626b]">
            <span className="flex items-center gap-1.5">
              <BellRing {...ICON} className="size-3" /> Your collector app
            </span>
            <span>{when}</span>
          </p>
          <p className={cn("mt-1 text-[13.5px] font-medium leading-snug", tone === "fix" ? "text-[#b5321f]" : "text-[#0b0c0e]")}>{title}</p>
          {body ? <p className="mt-0.5 text-[12.5px] leading-snug text-[#5c626b]">{body}</p> : null}
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
  return (
    <div>
      <div className="grid gap-3 sm:gap-4 md:grid-cols-2">
        <figure className="rounded-[20px] border border-hairline bg-panel px-4 pt-4 sm:px-6 sm:pt-5">
          <figcaption className="mb-3 flex items-center justify-between sm:mb-4">
            <span className="inline-flex items-center gap-2 text-[16px] font-medium">
              <Clock {...ICON} className="size-[18px] text-muted-foreground" /> Today
            </span>
            <span className="text-[13px] text-muted-foreground">the next day, after a person watched it</span>
          </figcaption>
          <Phone when="tomorrow" title="Your video was rejected." tone="plain" />
          <p className="sr-only">Today the contributor hears “Your video was rejected.” the next day, with no reason.</p>
        </figure>
        <figure className="rounded-[20px] border border-brand/30 bg-[linear-gradient(180deg,rgba(143,180,255,0.07),transparent_50%)] px-4 pt-4 sm:px-6 sm:pt-5">
          <figcaption className="mb-3 flex items-center justify-between sm:mb-4">
            <span className="inline-flex items-center gap-2 text-[16px] font-medium">
              <ScanLine {...ICON} className="size-[18px] text-brand" /> With Ormes
            </span>
            <span className="text-[13px] text-brand">seconds after upload</span>
          </figcaption>
          <Phone when="now" title={`Rejected at ${clock(at)}: ${message}`} body={reason.hint} action="Record again" tone="fix" />
          <p className="sr-only">
            With Ormes the contributor hears, seconds after upload: Rejected at {clock(at)}: {message} {reason.hint}
          </p>
        </figure>
      </div>
      <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
        <p className="text-[13px] text-muted-foreground">The reason and the hint are Ormes’s real output for a test video.</p>
        <MoreLink href="/product#demo">See it on video</MoreLink>
      </div>
    </div>
  );
}
