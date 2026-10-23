import { ButtonLink, Wrap } from "../primitives";
import { HeroScreen } from "./hero-screen";

/**
 * The only hero on the site (layout after didit.me, issue #69): headline, subline and the two
 * CTAs centred on the plain background, then the clip in a contained card whose top third shows
 * above the fold at 1440×900.
 */
export function Hero() {
  return (
    <section id="top" className="surface-dark relative overflow-hidden pb-16 pt-14 sm:pb-24 sm:pt-20">
      <div
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-[-25%] aspect-square w-[min(1100px,160vw)] -translate-x-1/2 bg-[radial-gradient(closest-side,rgba(143,180,255,0.13),rgba(143,180,255,0))]"
      />
      <Wrap className="relative">
        <div className="mx-auto max-w-[1000px] text-center">
          <h1 className="text-balance text-[clamp(34px,5vw,72px)] font-medium leading-[1.02] tracking-[-0.035em]">
            Stop watching every video before you pay for it.
          </h1>
          <p className="mx-auto mt-5 max-w-[58ch] text-pretty text-[clamp(16px,1.4vw,18px)] leading-relaxed text-muted-foreground">
            Ormes applies your lab’s spec to every first-person video and decides accept, reject or review. It checks what your reviewers check
            by hand: hands on the work, every step done, nothing private in view.
          </p>
          <div className="mt-7 flex flex-wrap justify-center gap-3">
            <ButtonLink href="/signup">Start a free pilot</ButtonLink>
            <ButtonLink href="/product" variant="outline">
              See how it decides
            </ButtonLink>
          </div>
        </div>
        <HeroScreen />
      </Wrap>
    </section>
  );
}
