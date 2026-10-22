"use client";

import { Hand, ListChecks, ScanFace } from "lucide-react";
import { ClipPlayer, useClip } from "../clip-player";
import { SITE_CLIPS } from "../clips";
import { ICON } from "../primitives";
import { HeroCanvas } from "./hero-canvas";

const FIELDS = [
  { icon: ListChecks, label: "Steps done", value: "3 of 3" },
  { icon: Hand, label: "Hands on the work", value: "92%", accent: true },
  { icon: ScanFace, label: "Personal data", value: "none" },
];
const TONE = { accept: "bg-ok/12 text-ok", review: "bg-brand/12 text-brand", reject: "bg-no/12 text-no" } as const;

/**
 * The hero's screen and decision card. With a real clip configured (SITE_CLIPS.hero) it plays the
 * clip with the hands model's boxes and shows the worker's own decision; otherwise the drawn
 * viewfinder and an example decision.
 */
export function HeroScreen() {
  const clip = useClip(SITE_CLIPS.hero);
  const side = clip && clip !== "missing" ? clip : null;
  const decision = side?.decision ?? null;

  return (
    <div className="relative mx-auto mt-14 max-w-[1040px]">
      <div className="relative aspect-[4/5] overflow-hidden rounded-[22px] border border-hairline bg-[#050607] sm:aspect-[16/9]">
        {side ? <ClipPlayer side={side} /> : <HeroCanvas />}
        <div aria-hidden className="absolute inset-x-0 top-0 flex items-center justify-between bg-gradient-to-b from-black/70 to-transparent p-4 font-mono text-[11px] uppercase tracking-[0.12em] text-white/70 sm:p-5">
          <span className="inline-flex items-center gap-2">
            <i className="size-2 rounded-full bg-no motion-safe:animate-pulse" />
            {side ? "Analysed by Ormes" : "REC 00:24"}
          </span>
          <span>{side ? side.id : "load the dishwasher"}</span>
        </div>
      </div>
      <div
        className="relative mx-4 -mt-20 rounded-2xl border border-hairline bg-panel/95 p-4 shadow-[0_30px_80px_-20px_rgba(0,0,0,0.9)] backdrop-blur sm:absolute sm:bottom-8 sm:right-8 sm:m-0 sm:w-[300px]"
        aria-label={side ? "Decision on this clip" : "Example decision"}
        role="group"
      >
        <div className="mb-2 flex items-center justify-between border-b border-hairline pb-3">
          <span className="font-mono text-[13px] text-muted-foreground">{side ? side.id : "v_88213"}</span>
          <span className={`rounded-md px-2 py-0.5 font-mono text-[12px] font-medium ${TONE[decision?.decision ?? "accept"]}`}>{decision?.decision ?? "accept"}</span>
        </div>
        {side && decision ? (
          <ul className="flex flex-col gap-1.5 py-1 text-[14px] text-muted-foreground">
            {decision.reasons.length === 0 ? <li>No reasons: every check passed.</li> : decision.reasons.slice(0, 3).map((r) => <li key={r.code}>{r.message}</li>)}
          </ul>
        ) : (
          <dl className="flex flex-col">
            {FIELDS.map(({ icon: Icon, label, value, accent }) => (
              <div key={label} className="flex items-center justify-between gap-3 py-2 text-[14px]">
                <dt className="inline-flex items-center gap-2 text-muted-foreground">
                  <Icon {...ICON} className="size-4" />
                  {label}
                </dt>
                <dd className={accent ? "font-mono text-[13px] text-brand" : "font-mono text-[13px] text-foreground"}>{value}</dd>
              </div>
            ))}
          </dl>
        )}
      </div>
    </div>
  );
}
