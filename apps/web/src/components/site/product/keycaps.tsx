"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { usePlayback } from "../use-playback";

const KEYS = [
  { key: "A", label: "Accept the video", wide: false },
  { key: "R", label: "Reject the video", wide: false },
  { key: "J", label: "Jump to the next flagged moment", wide: false },
  { key: "K", label: "Back to the previous flagged moment", wide: false },
  { key: "Enter", label: "Replay the current moment", wide: true },
  { key: "N", label: "Write a note that is kept with the decision", wide: false },
];

/** Product §4: the review keys, pressed in sequence, with what each one does. */
export function Keycaps() {
  const ref = useRef<HTMLDivElement>(null);
  const playing = usePlayback(ref);
  const [step, setStep] = useState(0);
  const [focus, setFocus] = useState<number | null>(null);

  useEffect(() => {
    if (!playing || focus !== null) return;
    const t = window.setInterval(() => setStep((s) => (s + 1) % KEYS.length), 1500);
    return () => clearInterval(t);
  }, [playing, focus]);

  const current = focus ?? step;
  return (
    <div ref={ref} className="flex flex-col items-center gap-8 rounded-[24px] border border-hairline bg-[radial-gradient(ellipse_at_50%_120%,rgba(143,180,255,0.1),transparent_60%)] px-4 py-10 sm:py-14">
      <ul className="grid grid-cols-3 gap-3 sm:flex sm:gap-4">
        {KEYS.map((k, i) => {
          const down = i === current;
          return (
            <li key={k.key} className={cn(k.wide && "col-span-1")}>
              <button
                type="button"
                aria-label={`${k.key}: ${k.label}`}
                onMouseEnter={() => setFocus(i)}
                onMouseLeave={() => setFocus(null)}
                onFocus={() => setFocus(i)}
                onBlur={() => setFocus(null)}
                className={cn(
                  "relative flex h-[72px] items-start justify-start rounded-[14px] border p-3 font-mono text-[18px] font-medium transition-all duration-150 sm:h-[88px] sm:text-[22px]",
                  k.wide ? "w-full sm:w-[150px]" : "w-full sm:w-[88px]",
                  down
                    ? "translate-y-[3px] border-brand bg-[#141b29] text-brand shadow-[0_1px_0_#0b0c0e,0_0_0_6px_rgba(143,180,255,0.12)]"
                    : "border-white/15 bg-[#16181c] text-foreground shadow-[0_4px_0_#0b0c0e,0_5px_0_rgba(255,255,255,0.08)]",
                )}
              >
                {k.key === "Enter" ? <span className="text-[15px] sm:text-[17px]">Enter ↵</span> : k.key}
              </button>
            </li>
          );
        })}
      </ul>
      <p className="flex min-h-7 items-center gap-3 text-center text-[17px]" aria-live="polite">
        <kbd className="rounded-md border border-white/15 bg-white/[0.06] px-2 py-0.5 font-mono text-[13px] text-brand">{KEYS[current].key}</kbd>
        {KEYS[current].label}
      </p>
      <p className="-mt-4 text-[13.5px] text-muted-foreground">↑ and ↓ move through the queue. No mouse needed.</p>
    </div>
  );
}
