import type { LucideIcon } from "lucide-react";
import {
  CircleCheck,
  CircleX,
  Copy,
  Crosshair,
  FileDown,
  FlaskConical,
  Gauge,
  GitBranch,
  Hand,
  Keyboard,
  ListChecks,
  Network,
  PlayCircle,
  ScanFace,
  Scale,
  UserRoundSearch,
} from "lucide-react";
import { ButtonLink, Divider, H2, ICON, Lead, PageIntro, Section, Soon } from "../primitives";
import { ContestFlow } from "./contest-flow";
import { ThreeOutcomes, TodayVsOrmes } from "./washing-up-demo";
import { DecisionDiagram } from "./decision-diagram";
import { ReviewConsole } from "./review-console";
import { LabChart } from "./lab-chart";
import { RubricEditor } from "./rubric-editor";

const RULE: { icon: LucideIcon; color: string; label: string; text: string }[] = [
  { icon: CircleX, color: "text-no", label: "Reject", text: "a critical check failed with a clear measurement." },
  { icon: UserRoundSearch, color: "text-brand", label: "Review", text: "a non-critical check failed, or a model was not sure. Never a silent reject." },
  { icon: CircleCheck, color: "text-ok", label: "Accept", text: "no reasons at all. The decision still carries every measurement." },
];

type Effect = "reject" | "review";
const CHECKS: { icon: LucideIcon; name: string; measures: string; set: string; effect: Effect; note: string }[] = [
  {
    icon: Hand,
    name: "Hands on the work",
    measures: "Share of handling time with each hand in frame; intervals where a hand is cut",
    set: "Minimum share, both hands or one, whole video or only while handling",
    effect: "reject",
    note: "critical, min 80%",
  },
  {
    icon: ListChecks,
    name: "Task completed",
    measures: "Each step found in order, final state reached, model confidence",
    set: "Steps, final state, minimum confidence",
    effect: "reject",
    note: "critical; unsure goes to review",
  },
  { icon: ScanFace, name: "Privacy", measures: "Faces, readable documents and screens: time and size of each", set: "Reject, review or ignore, per kind", effect: "review", note: "per kind" },
  {
    icon: Copy,
    name: "Already delivered",
    measures: "Similarity to your organisation’s earlier videos, edited copies included",
    set: "Similarity threshold, reject or review",
    effect: "reject",
    note: "at 0.90 or more",
  },
  { icon: Crosshair, name: "Framing", measures: "Time pointed away from the work, unstable time", set: "Maximum share of each", effect: "review", note: "not critical, max 10%" },
  {
    icon: Gauge,
    name: "Technical",
    measures: "Duration, resolution, frame rate, blurry and badly exposed frames",
    set: "Minimums and maximums",
    effect: "reject",
    note: "critical",
  },
];

// The real shortcuts of the review screen (app/app/review/review-workspace.tsx).
const SHORTCUTS: [string[], string][] = [
  [["A"], "Accept the video"],
  [["R"], "Reject it"],
  [["J", "K"], "Next or previous flagged moment"],
  [["↵"], "Replay the current moment"],
  [["N"], "Write a note, kept with the decision"],
  [["↑", "↓"], "Move through the queue"],
];

const NAV = [
  { href: "#decision", label: "Decision", icon: Network },
  { href: "#demo", label: "Demo", icon: PlayCircle },
  { href: "#checks", label: "Checks", icon: ListChecks },
  { href: "#rubrics", label: "Rubrics", icon: GitBranch },
  { href: "#review", label: "Review", icon: Keyboard },
  { href: "#contests", label: "Contests", icon: Scale },
  { href: "#lab", label: "Lab", icon: FlaskConical },
];

export function ProductPage() {
  return (
    <main>
      <PageIntro
        title="How Ormes decides"
        intro="What each check measures, how your rubric turns it into a decision, and the tools around it: review, contests and your lab’s outcomes."
        nav={NAV}
      />

      <Section id="decision" className="pt-12 sm:pt-16">
        <H2>Three answers, one rule.</H2>
        <Lead>Every check produces measurements. The rubric turns them into reasons. The reasons decide.</Lead>
        <div className="mt-10">
          <DecisionDiagram />
        </div>
        <ol className="mt-8 hidden gap-x-8 gap-y-4 sm:grid md:grid-cols-3">
          {RULE.map(({ icon: Icon, color, label, text }) => (
            <li key={label} className="flex gap-3 text-[15.5px] leading-relaxed">
              <Icon {...ICON} className={`mt-1 size-[18px] shrink-0 ${color}`} />
              <p>
                <b className="font-medium">{label}</b> <span className="text-muted-foreground">when {text}</span>
              </p>
            </li>
          ))}
        </ol>
      </Section>

      <Divider />

      <Section id="demo">
        <H2>One video, three answers.</H2>
        <Lead>A real washing-up video and two copies with a defect added. Decisions and reasons are Ormes’s output, unedited.</Lead>
        <div className="mt-8 sm:mt-10">
          <ThreeOutcomes />
        </div>
      </Section>

      <Divider />

      <Section id="compare">
        <H2>The same rejection, today and with Ormes.</H2>
        <Lead>Today a person watches it and the contributor hears “rejected” the next day. With Ormes: the reason and the moment, in seconds.</Lead>
        <div className="mt-8 sm:mt-10">
          <TodayVsOrmes />
        </div>
      </Section>

      <Divider />

      <Section id="checks">
        <H2>Every check, what it measures, what you set.</H2>
        <Lead>Each check can be critical (a failure rejects), not critical (a failure goes to review), or turned off. Defaults below.</Lead>
        <div className="-mx-4 mt-8 overflow-x-auto px-4 pb-2 [scrollbar-width:none] sm:-mx-6 sm:px-6 md:mx-0 md:mt-10 md:overflow-hidden md:rounded-[20px] md:border md:border-hairline md:px-0 md:pb-0">
          <div role="table" aria-label="Checks" className="flex snap-x snap-mandatory gap-3 text-[14.5px] md:block">
            <div role="row" className="hidden grid-cols-[minmax(0,1.1fr)_minmax(0,1.6fr)_minmax(0,1.4fr)_minmax(0,1fr)] gap-6 bg-panel px-6 py-3 font-mono text-[11.5px] uppercase tracking-[0.1em] text-muted-foreground md:grid">
              <span role="columnheader">Check</span>
              <span role="columnheader">Measures</span>
              <span role="columnheader">You set</span>
              <span role="columnheader">Default effect</span>
            </div>
            {CHECKS.map(({ icon: Icon, name, measures, set, effect, note }) => (
              <div
                role="row"
                key={name}
                className="grid w-[80%] shrink-0 snap-start content-start gap-2 rounded-2xl border border-hairline bg-panel p-4 md:w-auto md:grid-cols-[minmax(0,1.1fr)_minmax(0,1.6fr)_minmax(0,1.4fr)_minmax(0,1fr)] md:gap-6 md:rounded-none md:border-0 md:border-t md:bg-transparent md:px-6 md:py-3.5"
              >
                <span role="rowheader" className="flex items-center gap-2.5 font-medium">
                  <span className="inline-flex size-8 items-center justify-center rounded-lg bg-foreground/[0.06]">
                    <Icon {...ICON} className="size-4" />
                  </span>
                  {name}
                </span>
                <span role="cell" className="text-muted-foreground">
                  <span className="mr-1 font-mono text-[11px] uppercase tracking-[0.08em] text-muted-foreground/70 md:hidden">Measures · </span>
                  {measures}
                </span>
                <span role="cell" className="text-muted-foreground">
                  <span className="mr-1 font-mono text-[11px] uppercase tracking-[0.08em] text-muted-foreground/70 md:hidden">You set · </span>
                  {set}
                </span>
                <span role="cell" className="flex flex-wrap items-center gap-2">
                  <span className={`rounded-md px-2 py-0.5 font-mono text-[12.5px] ${effect === "reject" ? "bg-no/12 text-no" : "bg-brand/12 text-brand"}`}>{effect}</span>
                  <span className="text-[13px] text-muted-foreground">{note}</span>
                </span>
              </div>
            ))}
          </div>
        </div>
      </Section>

      <Divider />

      <Section id="rubrics">
        <H2>Versioned, and previewed before you save.</H2>
        <Lead>Draft it from the lab’s spec or a ready one, change a threshold, and see which recent decisions would change before you save.</Lead>
        <div className="mt-10">
          <RubricEditor />
        </div>
      </Section>

      <Divider />

      <Section id="review">
        <H2>Only doubtful videos, decided from the keyboard.</H2>
        <Lead>Each video arrives with its reasons pinned to the timeline. Reviewers jump between flagged moments and decide with one key.</Lead>
        <div className="mt-8 flex flex-col gap-5 sm:mt-10 sm:gap-6 lg:grid lg:grid-cols-[minmax(0,1fr)_230px] lg:items-center lg:gap-10">
          <ReviewConsole />
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2.5 sm:gap-x-8 lg:grid-cols-1 lg:gap-y-4" aria-label="Review shortcuts">
            {SHORTCUTS.map(([keys, label]) => (
              <div key={label} className="flex items-start gap-2 sm:gap-3">
                <dt className="flex shrink-0 gap-1">
                  {keys.map((k) => (
                    <kbd key={k} className="inline-flex h-7 min-w-7 items-center justify-center rounded-md border border-foreground/15 bg-foreground/[0.06] px-1.5 font-mono text-[12.5px] text-foreground">
                      {k}
                    </kbd>
                  ))}
                </dt>
                <dd className="pt-1 text-[13px] leading-snug text-muted-foreground sm:text-[14px]">{label}</dd>
              </div>
            ))}
          </dl>
        </div>
      </Section>

      <Divider />

      <Section id="contests">
        <H2>A person can always contest.</H2>
        <Lead>A contributor who disagrees opens a contest from a link. A person on your team upholds or overturns it, with a note.</Lead>
        <div className="mt-10">
          <ContestFlow />
        </div>
      </Section>

      <Divider />

      <Section id="lab">
        <div className="grid gap-6 sm:gap-10 lg:grid-cols-[0.9fr_1.1fr] lg:items-start">
          <div>
            <H2>Measured against your lab, not against itself.</H2>
            <Lead>
              Send the lab’s verdicts on delivered videos. Ormes reports precision and recall on rejections against your reject rate.
            </Lead>
            <p className="mt-4 flex flex-wrap items-center gap-2 text-[14px] text-muted-foreground sm:mt-6">
              <FileDown {...ICON} className="size-4 shrink-0" />
              Audit export per batch and rubric version, CSV and JSON <Soon />
            </p>
          </div>
          <LabChart />
        </div>
      </Section>

      <section className="border-t border-hairline py-20 sm:py-24">
        <div className="mx-auto flex max-w-[1160px] flex-col items-start justify-between gap-6 px-4 sm:flex-row sm:items-center sm:px-6">
          <div>
            <h2 className="text-[clamp(26px,3.4vw,36px)] font-medium tracking-[-0.02em]">See it on your own videos.</h2>
            <p className="mt-2 max-w-[56ch] text-[16px] text-muted-foreground">Send a batch your reviewers have already judged. We return the decisions and a report of the hours saved.</p>
          </div>
          <div className="flex flex-wrap gap-3">
            <ButtonLink href="/signup">Start a free pilot</ButtonLink>
            <ButtonLink href="/docs" variant="outline">
              Read the docs
            </ButtonLink>
          </div>
        </div>
      </section>
    </main>
  );
}
