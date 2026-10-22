import { Plus } from "lucide-react";
import { ButtonLink, H2, ICON, Lead, MoreLink, Section, Wrap } from "../primitives";
import { CheckTiles } from "./check-tiles";
import { FreePilot } from "./free-pilot";
import { Hero } from "./hero";
import { Integration } from "./integration";
import { PrivacyPipeline } from "./privacy-pipeline";
import { Problem } from "./problem";
import { VideoFlow } from "./video-flow";
import { WhyOrmes } from "./why-ormes";

/*
 * Home answers one buyer question: "Is it worth trying?" Nine sections, one question each (issue #69):
 * what is it, do you understand my problem, what do I get, what does it look at, why aren't my
 * reviewers enough, are my videos safe, is it hard to integrate, how do I try it, remaining doubts.
 */

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
  {
    q: "Can Ormes reject a good video?",
    a: "It sends doubtful cases to review, never a silent reject. A reject needs a clear measurement against your rubric, and a contributor can always contest it with a person.",
  },
];

export function HomePage() {
  return (
    <main>
      <Hero />

      <Section id="problem" className="pt-10 sm:pt-16">
        <H2>Every video waits for a person.</H2>
        <Lead>Uploads arrive faster than reviewers can watch them, and every hour in the queue is a contributor waiting to be paid.</Lead>
        <div className="mt-12">
          <Problem />
        </div>
      </Section>

      <Section id="flow">
        <H2>Your reviewers only see the doubtful ones.</H2>
        <Lead>Ormes makes the calls your reviewers make by hand and sends only what it can’t settle to review.</Lead>
        <div className="mt-12">
          <VideoFlow />
        </div>
      </Section>

      <Section id="checks" className="sm:py-24">
        <H2>What it checks, on every video.</H2>
        <Lead>Each check returns a measurement and the moments it found. Your rubric decides what rejects and what goes to review.</Lead>
        <div className="mt-10">
          <CheckTiles />
        </div>
        <MoreLink href="/product#checks" className="mt-6">
          Every check and setting
        </MoreLink>
      </Section>

      <Section id="why" className="surface-dark">
        <H2>A decision in seconds, with a reason they can fix.</H2>
        <Lead>Same video, same spec. Today it waits for a person and the contributor hears “rejected”. With Ormes they hear why, and when, while they can still record again.</Lead>
        <div className="mt-12">
          <WhyOrmes />
        </div>
      </Section>

      <Section id="privacy" className="sm:py-24">
        <H2>Videos are checked, not kept.</H2>
        <Lead>Each video is deleted after its decision; one waiting for a reviewer, within 14 days. No training unless you opt in.</Lead>
        <div className="mt-10">
          <PrivacyPipeline />
        </div>
        <MoreLink href="/security" className="mt-6">
          How your videos are handled
        </MoreLink>
      </Section>

      <Section id="api" className="sm:py-24">
        <H2>One call where you approve videos today.</H2>
        <div className="mt-10">
          <Integration />
        </div>
      </Section>

      <Section id="pilot">
        <H2>Try it on videos you already judged.</H2>
        <Lead>A free pilot in shadow mode: no integration, a report in 48 hours, measured against criteria we agree on first.</Lead>
        <div className="mt-12">
          <FreePilot />
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

      <section id="start" className="surface-dark relative overflow-hidden py-24 sm:py-32">
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
