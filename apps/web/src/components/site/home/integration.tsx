import { FileCode2, Upload, Webhook } from "lucide-react";
import { ICON, MoreLink } from "../primitives";

const STEPS = [
  { icon: FileCode2, title: "Write the rubric", text: "Once per task, from your lab’s spec." },
  { icon: Upload, title: "Send each upload", text: "One SDK call in TypeScript or Python." },
  { icon: Webhook, title: "Act on the decision", text: "Signed webhook or polling, with every reason." },
];

const k = "text-brand"; // keywords
const f = "text-foreground"; // names
const s = "text-[#9fd4b4]"; // strings
const c = "text-muted-foreground"; // comments

/** Home §7 (dark): three steps next to the code that does them. The full examples live in the docs. */
export function Integration() {
  return (
    <div className="grid items-center gap-8 lg:grid-cols-[0.8fr_1.2fr] lg:gap-14">
      <div>
        <ol className="flex flex-col gap-4 sm:gap-6">
          {STEPS.map(({ icon: Icon, title, text }, i) => (
            <li key={title} className="flex gap-4">
              <span className="relative inline-flex size-10 shrink-0 items-center justify-center rounded-xl border border-hairline text-brand sm:size-11">
                <Icon {...ICON} className="size-5" />
                <span className="absolute -right-1.5 -top-1.5 inline-flex size-5 items-center justify-center rounded-full bg-brand font-mono text-[11px] font-medium text-on-brand">
                  {i + 1}
                </span>
              </span>
              <div>
                <h3 className="text-[16.5px] font-medium tracking-[-0.01em] sm:text-[18px]">{title}</h3>
                <p className="mt-0.5 text-[14.5px] leading-snug text-muted-foreground sm:text-[15px]">{text}</p>
              </div>
            </li>
          ))}
        </ol>
        <MoreLink href="/docs/quickstart" className="mt-6 sm:mt-8">
          Read the quickstart
        </MoreLink>
      </div>

      <figure className="overflow-hidden rounded-[18px] border border-hairline bg-panel">
        <figcaption className="flex items-center justify-between border-b border-hairline px-4 py-2.5 font-mono text-[12px] text-muted-foreground">
          <span>upload.ts</span>
          <span>@ormes/sdk</span>
        </figcaption>
        <pre className="overflow-x-auto px-4 py-4 font-mono text-[12px] leading-[1.75] sm:px-5 sm:py-5 sm:text-[14px]">
          <code>
            <span className={k}>import</span> {"{ "}
            <span className={f}>Ormes</span>
            {" } "}
            <span className={k}>from</span> <span className={s}>&quot;@ormes/sdk&quot;</span>;{"\n\n"}
            <span className={k}>const</span> <span className={f}>ormes</span> = <span className={k}>new</span> <span className={f}>Ormes</span>();{" "}
            <span className={c}>{"// reads ORMES_API_KEY"}</span>
            {"\n\n"}
            <span className={k}>const</span> <span className={f}>video</span> = <span className={k}>await</span> ormes.videos.
            <span className={f}>upload</span>(file, {"{ "}
            rubric_id {"}"});{"\n"}
            <span className={k}>const</span> {"{ "}
            <span className={f}>decision</span>
            {" } "}= <span className={k}>await</span> ormes.videos.<span className={f}>waitForDecision</span>(video.id);{"\n\n"}
            <span className={c}>{'// "accept" | "review" | "reject", with every reason'}</span>
            {"\n"}
            decision.decision;
          </code>
        </pre>
      </figure>
    </div>
  );
}
