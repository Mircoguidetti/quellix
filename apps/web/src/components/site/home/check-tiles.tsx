import type { LucideIcon } from "lucide-react";
import { Copy, Crosshair, Gauge, Hand, ListChecks, ScanFace } from "lucide-react";
import { ICON } from "../primitives";

const CHECKS: { icon: LucideIcon; title: string; text: string }[] = [
  { icon: Hand, title: "Hands on the work", text: "Both hands visible while they handle objects." },
  { icon: ListChecks, title: "Task completed", text: "Every step found in order, final state checked." },
  { icon: ScanFace, title: "Privacy", text: "Faces, readable documents and screens, with their times." },
  { icon: Copy, title: "Already delivered", text: "Re-uploads and edited copies of your earlier videos." },
  { icon: Crosshair, title: "Framing", text: "Camera on the work and steady, against your limits." },
  { icon: Gauge, title: "Technical", text: "Duration, resolution, frame rate, blur and exposure." },
];

/** Home §4: the six checks, icon, name and one line each (issue #85: no illustrations). */
export function CheckTiles() {
  return (
    <ul className="grid grid-cols-2 gap-x-4 gap-y-6 sm:gap-x-8 sm:gap-y-10 lg:grid-cols-3">
      {CHECKS.map(({ icon: Icon, title, text }) => (
        <li key={title} className="flex flex-col gap-2 sm:gap-3">
          <span className="inline-flex size-9 items-center justify-center rounded-xl bg-foreground/[0.06] text-foreground sm:size-10">
            <Icon {...ICON} className="size-[18px] sm:size-5" />
          </span>
          <h3 className="text-[15.5px] font-medium tracking-[-0.01em] sm:text-[18px]">{title}</h3>
          <p className="text-[13.5px] leading-snug text-muted-foreground sm:text-[15px] sm:leading-relaxed">{text}</p>
        </li>
      ))}
    </ul>
  );
}
