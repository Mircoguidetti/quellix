import { FileCode2, Upload, Webhook } from "lucide-react";
import { ICON, MoreLink } from "../primitives";

const STEPS = [
  { icon: FileCode2, title: "Write the rubric", text: "Once per task, from your lab’s spec." },
  { icon: Upload, title: "Send each upload", text: "One SDK call in TypeScript or Python." },
  { icon: Webhook, title: "Act on the decision", text: "Signed webhook or polling, with every reason." },
];

/** Home §7: three steps and one line of code. The full examples live in the docs. */
export function Integration() {
  return (
    <div>
      <ol className="relative grid gap-10 md:grid-cols-3 md:gap-8">
        <span aria-hidden className="absolute left-[22px] top-6 hidden h-px w-[calc(100%-44px)] bg-[linear-gradient(90deg,var(--color-hairline),rgba(143,180,255,0.5),var(--color-hairline))] md:block" />
        {STEPS.map(({ icon: Icon, title, text }, i) => (
          <li key={title} className="relative flex gap-4 md:flex-col">
            <span className="relative inline-flex size-12 shrink-0 items-center justify-center rounded-2xl border border-hairline bg-background text-brand">
              <Icon {...ICON} className="size-[22px]" />
              <span className="absolute -right-1.5 -top-1.5 inline-flex size-5 items-center justify-center rounded-full bg-brand font-mono text-[11px] font-medium text-on-brand">{i + 1}</span>
            </span>
            <div>
              <h3 className="text-[18px] font-medium tracking-[-0.01em]">{title}</h3>
              <p className="mt-1.5 max-w-[34ch] text-[15px] leading-relaxed text-muted-foreground">{text}</p>
            </div>
          </li>
        ))}
      </ol>
      <div className="mt-12 flex flex-col items-start gap-5 sm:flex-row sm:items-center sm:justify-between">
        <code className="max-w-full rounded-2xl border border-hairline bg-panel px-5 py-3 font-mono text-[13px] text-muted-foreground sm:whitespace-nowrap sm:rounded-full sm:text-[14.5px]">
          <span className="text-brand">await</span> <span className="text-foreground">ormes.videos.upload</span>(file, {"{ "}
          <span className="text-foreground">rubric_id</span>
          {" })"}
        </code>
        <MoreLink href="/docs">Read the docs</MoreLink>
      </div>
    </div>
  );
}
