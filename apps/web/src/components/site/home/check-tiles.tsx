"use client";

import { useRef } from "react";
import type { LucideIcon } from "lucide-react";
import { Copy, Crosshair, Gauge, Hand, ListChecks, ScanFace } from "lucide-react";
import { cn } from "@/lib/utils";
import { ICON } from "../primitives";
import { usePlayback } from "../use-playback";
import s from "./home.module.css";

function Tile({
  icon: Icon,
  title,
  primary,
  text,
  children,
  className,
}: {
  icon: LucideIcon;
  title: string;
  primary?: boolean;
  text: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <li
      className={cn(
        "group flex flex-col overflow-hidden rounded-[20px] border border-hairline transition-colors hover:border-white/20",
        primary ? "bg-[linear-gradient(180deg,#0e1218,#0b0c0e)]" : "bg-panel",
        className,
      )}
    >
      <div className={cn("relative border-b border-hairline", primary ? "h-[148px]" : "h-[112px]")} aria-hidden="true">
        {children}
      </div>
      <div className="flex flex-1 flex-col gap-1.5 p-4">
        <h3 className="flex items-center gap-2.5 text-[17px] font-medium tracking-[-0.01em]">
          <span className={cn("inline-flex size-8 items-center justify-center rounded-lg", primary ? "bg-brand/15 text-brand" : "bg-white/[0.06] text-foreground")}>
            <Icon {...ICON} className="size-[18px]" />
          </span>
          {title}
          {primary ? <span className="ml-auto rounded-full bg-brand/12 px-2 py-px text-[12px] text-brand">Core</span> : null}
        </h3>
        <p className="text-[14px] leading-relaxed text-muted-foreground">{text}</p>
      </div>
    </li>
  );
}

const mono = "font-mono text-[11px] tracking-[0.04em]";

function HandsVisual() {
  return (
    <div className="absolute inset-0 flex flex-col justify-center gap-5 px-5 sm:px-7">
      <div className="relative h-9">
        <div className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-white/10" />
        <div className="absolute inset-y-0 rounded-md bg-brand/[0.13]" style={{ left: "8%", width: "32%" }} />
        <div className="absolute inset-y-0 rounded-md bg-brand/[0.13]" style={{ left: "52%", width: "36%" }} />
        <div className="absolute inset-y-1 rounded-sm bg-no/25 ring-1 ring-no/60" style={{ left: "70%", width: "6%" }} />
        <span className={cn(mono, "absolute -top-5 text-brand/80")} style={{ left: "8%" }}>
          handling
        </span>
        <span className={cn(mono, "absolute -top-5 text-no")} style={{ left: "66%" }}>
          00:41–00:52 cut
        </span>
        <span className={cn(s.handsHead, "absolute -inset-y-1 w-px bg-white")} />
      </div>
      <div className="flex items-center gap-3">
        <span className="relative h-2 flex-1 rounded-full bg-white/[0.06]">
          <span className={cn(s.handsFill, "block h-full rounded-full bg-brand")} />
          <span className="absolute -inset-y-1 left-[80%] w-px bg-white/60" />
        </span>
        <span className="font-mono text-[13px] text-brand">91%</span>
      </div>
      <div className={cn(mono, "-mt-3 flex justify-between text-muted-foreground")}>
        <span>both hands visible while handling</span>
        <span>min 80%</span>
      </div>
    </div>
  );
}

const STEPS = [
  { label: "Open the door", at: "00:03" },
  { label: "Load the racks", at: "01:12" },
  { label: "Close the door", at: "02:41" },
];

function TaskVisual() {
  return (
    <div className="absolute inset-0 flex flex-col justify-center px-5 sm:px-7">
      <div className="relative flex justify-between">
        <div className="absolute inset-x-4 top-[13px] h-px bg-white/10" />
        <div className={cn(s.stepLine, "absolute inset-x-4 top-[13px] h-px bg-brand")} />
        {STEPS.map((step, i) => (
          <div key={step.label} className="relative flex w-24 flex-col items-center gap-2 text-center first:items-start first:text-left last:items-end last:text-right">
            <span
              className={cn(s.step, "flex size-[27px] items-center justify-center rounded-full border border-brand bg-brand font-mono text-[12px] font-medium text-black")}
              style={{ "--i": i } as React.CSSProperties}
            >
              {i + 1}
            </span>
            <span className="text-[13px] leading-tight text-foreground">{step.label}</span>
            <span className={cn(mono, "text-muted-foreground")}>{step.at}</span>
          </div>
        ))}
      </div>
      <p className={cn(mono, "mt-4 text-brand")}>3 of 3 steps · final state reached</p>
    </div>
  );
}

function PrivacyVisual() {
  return (
    <div className="absolute inset-0 overflow-hidden bg-[radial-gradient(circle_at_30%_80%,rgba(255,255,255,0.05),transparent_60%)]">
      <div className="absolute bottom-0 left-[12%] h-[54%] w-[40%] rounded-t-[40%] bg-white/[0.05]" />
      <div className="absolute bottom-[42%] left-[22%] size-11 rounded-full bg-white/[0.08]" />
      <div className={cn(s.faceBox, "absolute bottom-[38%] left-[18%] size-16 rounded-md border-[1.5px] border-brand")} />
      <span className={cn(s.faceTag, mono, "absolute bottom-[calc(38%+36px)] left-[calc(18%+72px)] whitespace-nowrap rounded bg-brand px-1.5 py-0.5 text-black")}>
        face 00:12 · review
      </span>
      <div className="absolute right-[10%] top-[22%] h-[46%] w-[24%] rotate-3 rounded bg-white/[0.07]" />
    </div>
  );
}

function DuplicateVisual() {
  const frame = "absolute left-0 top-0 h-[64px] w-[104px] rounded-lg border";
  return (
    <div className="absolute inset-0 overflow-hidden">
      <div className="absolute left-1/2 top-1/2 h-[76px] w-[196px] -translate-x-1/2 -translate-y-1/2">
        <div className={cn(frame, "border-white/20 bg-[#141922]")}>
          <span className={cn(mono, "absolute bottom-1 left-2 text-muted-foreground")}>v_80102</span>
        </div>
        <div className={cn(s.dupTop, frame, "border-no/70 bg-[#1a1416]/95")}>
          <span className={cn(mono, "absolute bottom-1 left-2 text-no")}>v_88214</span>
        </div>
        <span className={cn(s.dupScore, "absolute right-0 top-[18px] rounded-md bg-no/15 px-2 py-0.5 font-mono text-[15px] text-no")}>0.98</span>
      </div>
    </div>
  );
}

function FramingVisual() {
  return (
    <div className="absolute inset-0 overflow-hidden">
      <div className="absolute left-1/2 top-1/2 h-12 w-20 -translate-x-1/2 -translate-y-1/2 rounded-md border border-dashed border-white/25 bg-white/[0.04]">
        <span className={cn(mono, "absolute -top-5 left-0 text-muted-foreground")}>the work</span>
      </div>
      <div className="absolute left-1/2 top-1/2 -ml-7 -mt-7">
        <div className={cn(s.reticle, "relative size-14 rounded-full border-[1.5px] border-brand")}>
          <span className="absolute left-1/2 top-[-6px] h-3 w-px bg-brand" />
          <span className="absolute bottom-[-6px] left-1/2 h-3 w-px bg-brand" />
          <span className="absolute left-[-6px] top-1/2 h-px w-3 bg-brand" />
          <span className="absolute right-[-6px] top-1/2 h-px w-3 bg-brand" />
        </div>
      </div>
      <span className={cn(mono, "absolute bottom-3 right-4 text-muted-foreground")}>off target 4%</span>
    </div>
  );
}

function TechnicalVisual() {
  const rows = [
    { label: "blur", value: "1.2%", v: "12%", limit: "50%", max: "max 5%" },
    { label: "bad exposure", value: "3%", v: "15%", limit: "50%", max: "max 10%" },
  ];
  return (
    <div className="absolute inset-0 flex flex-col justify-center gap-4 px-5">
      {rows.map((r) => (
        <div key={r.label}>
          <div className={cn(mono, "mb-1.5 flex justify-between text-muted-foreground")}>
            <span>{r.label}</span>
            <span className="text-foreground">{r.value}</span>
          </div>
          <div className="relative h-1.5 rounded-full bg-white/[0.06]">
            <span className={cn(s.meter, "block h-full rounded-full bg-ok")} style={{ "--v": r.v } as React.CSSProperties} />
            <span className="absolute -top-1 h-3.5 w-px bg-white/50" style={{ left: r.limit }} title={r.max} />
          </div>
        </div>
      ))}
      <p className={cn(mono, "text-muted-foreground")}>1920×1080 · 30 fps · 02:44</p>
    </div>
  );
}

/** Home §3: the six checks, each with its own small live visual. Hands and Task lead. */
export function CheckTiles() {
  const ref = useRef<HTMLUListElement>(null);
  const playing = usePlayback(ref);
  return (
    <ul ref={ref} data-play={playing ? "" : undefined} className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-12">
      <Tile
        icon={Hand}
        title="Hands on the work"
        primary
        className="lg:col-span-6"
        text="Both hands visible while they handle objects. Hands cut by the edge are found to the second."
      >
        <HandsVisual />
      </Tile>
      <Tile
        icon={ListChecks}
        title="Task completed"
        primary
        className="lg:col-span-6"
        text="Every step found in order, final state checked. Not sure means review, never accept."
      >
        <TaskVisual />
      </Tile>
      <Tile icon={ScanFace} title="Privacy" className="lg:col-span-3" text="Faces, readable documents and screens, with their times.">
        <PrivacyVisual />
      </Tile>
      <Tile icon={Copy} title="Already delivered" className="lg:col-span-3" text="Re-uploads and edited copies of your own earlier videos.">
        <DuplicateVisual />
      </Tile>
      <Tile icon={Crosshair} title="Framing" className="lg:col-span-3" text="Camera on the work and steady, against your limits.">
        <FramingVisual />
      </Tile>
      <Tile icon={Gauge} title="Technical" className="lg:col-span-3" text="Duration, resolution, frame rate, blur and exposure.">
        <TechnicalVisual />
      </Tile>
    </ul>
  );
}
