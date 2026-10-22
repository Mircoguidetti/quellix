"use client";

import { useState } from "react";
import { BadgePercent, Ban, BrainCircuit, Check, Cloud } from "lucide-react";
import { cn } from "@/lib/utils";
import { ICON } from "../primitives";

function Switch({ on, onChange, label, disabled }: { on: boolean; onChange?: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange?.(!on)}
      className={cn(
        "relative h-8 w-14 shrink-0 rounded-full border transition-colors duration-200",
        on ? "border-brand bg-brand" : "border-white/15 bg-white/[0.06]",
        disabled ? "cursor-default" : "cursor-pointer",
      )}
    >
      <span className={cn("absolute left-0 top-[3px] size-6 rounded-full shadow transition-transform duration-200", on ? "translate-x-[27px] bg-black" : "translate-x-[3px] bg-white/80")} />
    </button>
  );
}

/** Security §4: training is off unless you opt in; third-party models are off by default. */
export function TrainingToggle() {
  const [training, setTraining] = useState(false);
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="flex flex-col rounded-[22px] border border-hairline bg-panel p-6">
        <div className="flex items-center justify-between gap-4">
          <p className="inline-flex items-center gap-2.5 text-[17px] font-medium">
            <BrainCircuit {...ICON} className="size-5 text-brand" /> Training on your videos
          </p>
          <div className="flex items-center gap-3">
            <span className={cn("font-mono text-[13px]", training ? "text-brand" : "text-muted-foreground")}>{training ? "On" : "Off"}</span>
            <Switch on={training} onChange={setTraining} label="Training on your videos (preview)" />
          </div>
        </div>
        <ul className="mt-6 flex flex-col gap-3 text-[14.5px]" aria-live="polite">
          {training ? (
            <>
              <li className="flex gap-2.5">
                <BadgePercent {...ICON} className="mt-0.5 size-4 shrink-0 text-ok" /> You pay less per hour of video.
              </li>
              <li className="flex gap-2.5">
                <Check {...ICON} className="mt-0.5 size-4 shrink-0 text-ok" /> Your videos train Ormes’s own models only.
              </li>
              <li className="flex gap-2.5">
                <Ban {...ICON} className="mt-0.5 size-4 shrink-0 text-muted-foreground" /> Still never resold, and never shown to another customer.
              </li>
            </>
          ) : (
            <>
              <li className="flex gap-2.5">
                <Check {...ICON} className="mt-0.5 size-4 shrink-0 text-ok" /> Your videos train nothing.
              </li>
              <li className="flex gap-2.5 text-muted-foreground">
                <BadgePercent {...ICON} className="mt-0.5 size-4 shrink-0" /> Turn it on in Settings for a lower price. Try the switch.
              </li>
            </>
          )}
        </ul>
        <p className="mt-auto pt-6 font-mono text-[11.5px] text-muted-foreground">Off by default · an owner or admin decides</p>
      </div>
      <div className="flex flex-col rounded-[22px] border border-hairline bg-panel p-6">
        <div className="flex items-center justify-between gap-4">
          <p className="inline-flex items-center gap-2.5 text-[17px] font-medium">
            <Cloud {...ICON} className="size-5 text-muted-foreground" /> Third-party models
          </p>
          <div className="flex items-center gap-3">
            <span className="font-mono text-[13px] text-muted-foreground">Off</span>
            <Switch on={false} label="Third-party models: off by default" disabled />
          </div>
        </div>
        <p className="mt-6 text-[14.5px] leading-relaxed text-muted-foreground">
          Your videos are analysed by Ormes’s own models. A video is sent to Google Gemini or TwelveLabs only if your organisation turns this on, for tasks our models
          don’t cover yet. Each decision records which model produced each measurement.
        </p>
        <p className="mt-auto pt-6 font-mono text-[11.5px] text-muted-foreground">Off by default · Settings → Data &amp; privacy</p>
      </div>
    </div>
  );
}
