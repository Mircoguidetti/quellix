import { Code2, MonitorCheck, Trash2 } from "lucide-react";
import { ButtonLink, ICON, Wrap } from "../primitives";
import { HeroScreen } from "./hero-screen";

const TRUST = [
  { icon: Code2, label: "API and SDKs" },
  { icon: MonitorCheck, label: "Review console" },
  { icon: Trash2, label: "Videos deleted after analysis" },
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

        <HeroScreen />
      </Wrap>
    </section>
  );
}
