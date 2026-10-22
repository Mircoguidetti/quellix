import {
  ArrowRight,
  BadgeDollarSign,
  CircleHelp,
  Clock,
  FileSignature,
  FlaskConical,
  Gavel,
  Percent,
  Plus,
  Sparkles,
} from "lucide-react";
import { ButtonLink, H2, ICON, Lead, MoreLink, Section, Wrap } from "../primitives";
import { CheckTiles } from "./check-tiles";
import { ContributorFeedback } from "./contributor-phone";
import { Hero } from "./hero";
import { Integration } from "./integration";
import { PrivacyPipeline } from "./privacy-pipeline";
import { ReviewConsole } from "./review-console";
import { VideoFlow } from "./video-flow";

const LIMITS = [
  { icon: BadgeDollarSign, title: "It doesn’t sell your data.", text: "We check your videos and delete them. We don’t offer them to labs or to other customers." },
  { icon: Gavel, title: "It doesn’t take the last word.", text: "You set the rubric, reviewers can override any decision, and contributors can contest a rejection with a person." },
  {
    icon: FlaskConical,
    title: "It doesn’t promise what your lab will accept.",
    text: "It applies the spec you give it, the same way on every video. Send your lab’s decisions and we measure ourselves against them.",
  },
  { icon: CircleHelp, title: "It doesn’t reject when it isn’t sure.", text: "A doubtful case goes to review. A wrong rejection costs a contributor money, so we treat it as the worst mistake." },
];

const PRICING = [
  { icon: Sparkles, title: "Free pilot", text: "On videos your reviewers already judged, with a report of the hours saved." },
  { icon: Clock, title: "Usage-based", text: "Billed per hour of video checked." },
  { icon: Percent, title: "Training discount", text: "Lower price if you allow training on your videos. Off unless you opt in." },
  { icon: FileSignature, title: "DPA included", text: "A data processing agreement for every customer." },
];

const FAQ = [
  {
    q: "We already check uploads. Why Ormes?",
    a: "Upload checks catch technical problems. The expensive calls are hands, steps and privacy, which today need a person. Ormes makes those calls with reasons and sends only the doubtful ones to your reviewers.",
  },
  {
    q: "Why not prompt a general video model?",
    a: "In published tests of judging whether a task succeeded, the best general model is wrong about one time in four, and they lean toward “success”. Those are the videos your lab sends back. Ormes uses its own models for hands and tasks, and sends doubtful cases to review.",
  },
  { q: "Who sets the criteria?", a: "You, from your lab’s spec. Each task has its own rubric, and every decision records the rubric version it used." },
  {
    q: "How accurate is it?",
    a: "We report precision and recall on rejections against your own reject rate, on videos your reviewers or your lab have already judged. That is the pilot report.",
  },
  {
    q: "Does Ormes keep my videos?",
    a: "No. Videos are deleted after analysis; those waiting for review within 14 days. We keep decisions, reasons and measurements so you have a record of every call.",
  },
];

export function HomePage() {
  return (
    <main>
      <Hero />

      <Section id="flow" className="pt-10 sm:pt-16">
        <H2>Your reviewers only see the doubtful ones.</H2>
        <Lead>
          Your upload checks catch blur. Hands out of frame, tasks stopped early and faces in view still need a person. Ormes makes those calls and
          sends only what it can’t settle to review.
        </Lead>
        <div className="mt-12">
          <VideoFlow />
        </div>
      </Section>

      <Section id="checks">
        <H2>The checks your reviewers do, on every video.</H2>
        <Lead>Each check returns a measurement and the moments it found. Your rubric decides what rejects, what goes to review and what is ignored.</Lead>
        <div className="mt-12">
          <CheckTiles />
        </div>
        <MoreLink href="/product#checks" className="mt-8">
          Every check and setting
        </MoreLink>
      </Section>

      <Section id="console">
        <H2>Doubtful cases take seconds, not minutes.</H2>
        <Lead>Reviewers never watch a whole video. They jump to the flagged moments, decide with one key and move on. Every override is kept with its note.</Lead>
        <div className="mt-12">
          <ReviewConsole />
        </div>
      </Section>

      <Section id="coach">
        <H2>Fewer rejections, not only faster ones.</H2>
        <Lead>
          A reject is an hour you can’t bill and money an honest contributor doesn’t get. Ormes says what went wrong and when, while they can still
          record again.
        </Lead>
        <div className="mt-14">
          <ContributorFeedback />
        </div>
      </Section>

      <Section id="api">
        <H2>One call where you approve videos today.</H2>
        <Lead>The decision comes back by signed webhook or by polling, with every reason and measurement.</Lead>
        <div className="mt-14">
          <Integration />
        </div>
      </Section>

      <Section id="privacy">
        <H2>Videos are checked, not kept.</H2>
        <Lead>Ormes analyses each video, returns its decision and deletes it. Nothing is used to train models unless you opt in.</Lead>
        <div className="mt-12">
          <PrivacyPipeline />
        </div>
        <MoreLink href="/security" className="mt-8">
          How your videos are handled
        </MoreLink>
      </Section>

      <Section id="limits">
        <div className="grid gap-10 lg:grid-cols-[0.8fr_1.2fr]">
          <H2>What Ormes doesn’t do.</H2>
          <ul className="flex flex-col">
            {LIMITS.map(({ icon: Icon, title, text }) => (
              <li key={title} className="grid grid-cols-[40px_minmax(0,1fr)] gap-4 border-t border-hairline py-6 last:border-b">
                <span className="relative inline-flex size-10 items-center justify-center rounded-full border border-hairline text-muted-foreground">
                  <Icon {...ICON} className="size-[18px]" />
                  <span aria-hidden className="absolute h-px w-7 rotate-[-40deg] bg-no/80" />
                </span>
                <div>
                  <h3 className="text-[18px] font-medium tracking-[-0.01em]">{title}</h3>
                  <p className="mt-1 text-[15px] leading-relaxed text-muted-foreground">{text}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </Section>

      <Section id="pricing">
        <div className="overflow-hidden rounded-[26px] border border-hairline bg-[linear-gradient(135deg,#0d1118,#0b0c0e_55%)]">
          <div className="grid lg:grid-cols-[1fr_1.1fr]">
            <div className="flex flex-col justify-between gap-8 p-6 sm:p-10">
              <div>
                <H2>Pay per hour of video checked.</H2>
                <Lead>Start with a free pilot on videos your reviewers have already judged. You see the hours saved before you pay anything.</Lead>
              </div>
              <ButtonLink href="/signup" className="w-fit">
                Start a free pilot <ArrowRight {...ICON} className="size-4" />
              </ButtonLink>
            </div>
            <ul className="grid border-t border-hairline sm:grid-cols-2 lg:border-l lg:border-t-0">
              {PRICING.map(({ icon: Icon, title, text }, i) => (
                <li key={title} className={`flex flex-col gap-3 p-6 sm:p-8 ${i % 2 === 0 ? "sm:border-r sm:border-hairline" : ""} ${i < 2 ? "border-b border-hairline" : i === 2 ? "border-b border-hairline sm:border-b-0" : ""}`}>
                  <Icon {...ICON} className="size-6 text-brand" />
                  <h3 className="text-[17px] font-medium">{title}</h3>
                  <p className="text-[14.5px] leading-relaxed text-muted-foreground">{text}</p>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </Section>

      <Section id="faq">
        <div className="grid gap-10 lg:grid-cols-[0.8fr_1.2fr]">
          <H2>Questions</H2>
          <div className="flex flex-col">
            {FAQ.map(({ q, a }) => (
              <details key={q} className="group border-t border-hairline last:border-b">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 py-5 text-[17px] font-medium [&::-webkit-details-marker]:hidden">
                  {q}
                  <Plus {...ICON} className="size-5 shrink-0 text-muted-foreground transition-transform duration-200 group-open:rotate-45" />
                </summary>
                <p className="-mt-1 pb-6 pr-8 text-[15.5px] leading-relaxed text-muted-foreground">{a}</p>
              </details>
            ))}
          </div>
        </div>
      </Section>

      <section id="start" className="relative overflow-hidden border-t border-hairline py-24 sm:py-32">
        <div
          aria-hidden
          className="pointer-events-none absolute bottom-[-60%] left-1/2 aspect-square w-[min(1000px,150vw)] -translate-x-1/2 bg-[radial-gradient(closest-side,rgba(143,180,255,0.16),rgba(143,180,255,0))]"
        />
        <Wrap className="relative text-center">
          <h2 className="mx-auto max-w-[18ch] text-balance text-[clamp(34px,5.4vw,64px)] font-medium leading-[1.02] tracking-[-0.035em]">
            Every video you pay for teaches a robot.
          </h2>
          <p className="mx-auto mt-5 max-w-[52ch] text-[17px] leading-relaxed text-muted-foreground">
            Make sure it teaches the right thing. Send videos your reviewers have already judged and see the report.
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <ButtonLink href="/signup">Start a free pilot</ButtonLink>
            <ButtonLink href="/docs" variant="outline">
              Read the docs
            </ButtonLink>
          </div>
        </Wrap>
      </section>
    </main>
  );
}
