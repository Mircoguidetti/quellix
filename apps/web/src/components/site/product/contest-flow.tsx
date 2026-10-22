import { ArrowRight, Lock, MessageSquareWarning, Scale } from "lucide-react";
import { ICON } from "../primitives";

/** Product §5: the contributor contests from a link; a person on your team resolves it. */
export function ContestFlow() {
  return (
    <div className="grid items-center gap-6 lg:grid-cols-[1fr_auto_1.15fr]">
      <figure className="mx-auto w-full max-w-[340px]">
        <figcaption className="mb-3 text-[14px] text-muted-foreground">1 · The contributor, from a link</figcaption>
        <div className="overflow-hidden rounded-[22px] border border-white/15 bg-[#f4f5f7] text-[#0b0c0e]">
          <div className="flex items-center gap-2 bg-[#e9ebee] px-3 py-2.5">
            <span className="flex flex-1 items-center gap-1.5 rounded-lg bg-white px-2.5 py-1 font-mono text-[11.5px] text-[#5c626b]">
              <Lock {...ICON} className="size-3" /> …/contest/v_88214
            </span>
          </div>
          <div className="p-4">
            <p className="text-[16px] font-medium">Your video was not accepted</p>
            <p className="mt-1 text-[12.5px] text-[#5c626b]">Load the dishwasher · uploaded Oct 21</p>
            <div className="mt-3 rounded-xl border border-[#f3c9c2] bg-[#fdeeeb] p-3 text-[13px]">
              <p className="font-medium text-[#b5321f]">Right hand not in view while handling</p>
              <p className="mt-0.5 font-mono text-[11.5px] text-[#b5321f]">61% · minimum 80%</p>
            </div>
            <p className="mt-3 rounded-xl border border-[#e6e8eb] bg-white p-3 text-[13px] text-[#5c626b]">
              My hand was behind the plate, it never left the frame.
            </p>
            <span className="mt-3 flex h-10 items-center justify-center gap-2 rounded-full bg-[#0b0c0e] text-[14px] font-medium text-white">
              <MessageSquareWarning {...ICON} className="size-4" /> Contest
            </span>
          </div>
        </div>
      </figure>

      <ArrowRight aria-hidden strokeWidth={1.5} className="mx-auto size-6 rotate-90 text-muted-foreground lg:rotate-0" />

      <figure className="w-full">
        <figcaption className="mb-3 text-[14px] text-muted-foreground">2 · A person on your team</figcaption>
        <div className="rounded-[22px] border border-hairline bg-panel p-5">
          <div className="flex items-center justify-between">
            <p className="inline-flex items-center gap-2 text-[15px] font-medium">
              <Scale {...ICON} className="size-4 text-brand" /> Contest · v_88214
            </p>
            <span className="font-mono text-[12px] text-muted-foreground">opened 2 h ago</span>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-1 rounded-xl bg-black p-1 text-[14px]">
            <span className="rounded-lg py-2 text-center text-muted-foreground">
              Upheld
            </span>
            <span className="rounded-lg bg-ok/15 py-2 text-center font-medium text-ok ring-1 ring-ok/40">
              Overturned
            </span>
          </div>
          <p className="mt-4 text-[12.5px] text-muted-foreground">Note, kept with the video</p>
          <p className="mt-1 rounded-xl border border-hairline bg-black/40 p-3 text-[14px]">The hand is behind the plate from 0:41, not out of frame. Accepting.</p>
          <ul className="mt-4 flex flex-col gap-1.5 text-[13.5px] text-muted-foreground">
            <li>Contributors only see the reasons that rejected the video, never internal signals such as duplicate matching.</li>
            <li className="text-foreground">An overturned rejection counts as our mistake in your precision report.</li>
          </ul>
        </div>
      </figure>
    </div>
  );
}
