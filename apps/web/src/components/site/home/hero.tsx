import { Code2, Hand, ListChecks, MonitorCheck, ScanFace, Trash2 } from "lucide-react";
import { ButtonLink, ICON, Wrap } from "../primitives";
import { HeroCanvas } from "./hero-canvas";

const TRUST = [
  { icon: Code2, label: "API and SDKs" },
  { icon: MonitorCheck, label: "Review console" },
  { icon: Trash2, label: "Videos deleted after analysis" },
];

const FIELDS = [
  { icon: ListChecks, label: "Steps done", value: "3 of 3" },
  { icon: Hand, label: "Hands on the work", value: "92%", accent: true },
  { icon: ScanFace, label: "Personal data", value: "none" },
];

/** The only hero on the site: headline, the viewfinder canvas and the decision card. */
export function Hero() {
  return (
    <section id="top" className="relative overflow-hidden pb-16 pt-16 sm:pt-24">
      <div
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-[-20%] aspect-square w-[min(1100px,160vw)] -translate-x-1/2 bg-[radial-gradient(closest-side,rgba(143,180,255,0.14),rgba(143,180,255,0))]"
      />
      <Wrap className="relative">
        <div className="mx-auto max-w-[900px] text-center">
          <h1 className="text-balance text-[clamp(42px,7.4vw,88px)] font-medium leading-[0.98] tracking-[-0.04em]">
            Stop watching every video before you pay for it.
          </h1>
          <p className="mx-auto mt-6 max-w-[58ch] text-pretty text-[clamp(17px,1.6vw,19px)] leading-relaxed text-muted-foreground">
            Ormes applies your lab’s spec to every first-person video and decides accept, reject or review. It checks what your reviewers check
            by hand: hands on the work, every step done, nothing private in view.
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <ButtonLink href="/signup">Start a free pilot</ButtonLink>
            <ButtonLink href="/product" variant="outline">
              See how it decides
            </ButtonLink>
          </div>
          <ul className="mt-8 flex flex-wrap justify-center gap-x-6 gap-y-2 text-[14px] text-muted-foreground">
            {TRUST.map(({ icon: Icon, label }) => (
              <li key={label} className="inline-flex items-center gap-2">
                <Icon {...ICON} className="size-4 text-brand" />
                {label}
              </li>
            ))}
          </ul>
        </div>

        <div className="relative mx-auto mt-14 max-w-[1040px]">
          <div className="relative aspect-[4/5] overflow-hidden rounded-[22px] border border-hairline bg-[#050607] sm:aspect-[16/9]">
            <HeroCanvas />
            <div aria-hidden className="absolute inset-x-0 top-0 flex items-center justify-between p-4 font-mono text-[11px] uppercase tracking-[0.12em] text-white/60 sm:p-5">
              <span className="inline-flex items-center gap-2">
                <i className="size-2 rounded-full bg-no motion-safe:animate-pulse" />
                REC 00:24
              </span>
              <span>load the dishwasher</span>
            </div>
          </div>
          <div
            className="relative mx-4 -mt-20 rounded-2xl border border-hairline bg-panel/95 p-4 shadow-[0_30px_80px_-20px_rgba(0,0,0,0.9)] backdrop-blur sm:absolute sm:bottom-8 sm:right-8 sm:m-0 sm:w-[300px]"
            aria-label="Example decision"
            role="group"
          >
            <div className="mb-2 flex items-center justify-between border-b border-hairline pb-3">
              <span className="font-mono text-[13px] text-muted-foreground">v_88213</span>
              <span className="rounded-md bg-ok/12 px-2 py-0.5 font-mono text-[12px] font-medium text-ok">accept</span>
            </div>
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
          </div>
        </div>
      </Wrap>
    </section>
  );
}
