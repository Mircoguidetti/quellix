import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import {
  BrainCircuit,
  Database,
  EyeOff,
  FileText,
  FileVideo,
  Fingerprint,
  FlaskConical,
  GitBranch,
  History,
  MessageSquareText,
  Ruler,
  Scale,
  ServerCog,
  ShieldCheck,
  Trash2,
  UserCheck,
  UserX,
  Waypoints,
} from "lucide-react";
import { ButtonLink, H2, ICON, Lead, MoreLink, PageIntro, Section } from "../primitives";
import { Isolation } from "./isolation";
import { Lifecycle } from "./lifecycle";
import { TrainingToggle } from "./training-toggle";

const KEPT: { icon: LucideIcon; text: string }[] = [
  { icon: Scale, text: "Decisions" },
  { icon: MessageSquareText, text: "Reasons" },
  { icon: Ruler, text: "Every measurement" },
  { icon: GitBranch, text: "The rubric version each decision used" },
  { icon: UserCheck, text: "Reviewer overrides, with their note" },
  { icon: FlaskConical, text: "Your lab’s outcomes" },
  { icon: Fingerprint, text: "Fingerprints that can’t be turned back into video" },
];
const NOT_KEPT: { icon: LucideIcon; text: string; note?: string }[] = [
  { icon: FileVideo, text: "The video, after the analysis" },
  { icon: UserX, text: "Contributor names, emails or payment details", note: "only your opaque id" },
  { icon: EyeOff, text: "Anything visible to another customer" },
];

const PROVIDERS = [
  { name: "Supabase", purpose: "Database, private file storage, sign-in", data: "Account data, decisions, videos until deletion", region: "EU (Stockholm)" },
  { name: "Vercel", purpose: "Web app and API", data: "Requests and account data; videos go straight to storage", region: "" },
  { name: "Modal", purpose: "Video analysis compute", data: "Videos during analysis only", region: "" },
  { name: "Google Gemini", purpose: "Third-party model", data: "Only if your organisation enables third-party models", region: "", optional: true },
  { name: "TwelveLabs", purpose: "Third-party model", data: "Only if your organisation enables third-party models", region: "", optional: true },
];

const NAV = [
  { href: "#lifecycle", label: "Lifecycle", icon: History },
  { href: "#kept", label: "What we keep", icon: Database },
  { href: "#isolation", label: "Isolation", icon: Waypoints },
  { href: "#training", label: "Training", icon: BrainCircuit },
  { href: "#providers", label: "Providers", icon: ServerCog },
];

export function SecurityPage() {
  return (
    <main>
      <PageIntro
        title="How your videos are handled"
        intro="What happens to a video from upload to deletion, what we keep, who can see it and who processes it."
        nav={NAV}
      />

      <Section id="lifecycle" className="pt-12 sm:pt-16">
        <H2>Checked, then deleted.</H2>
        <Lead>Every video follows the same path. The only video we hold on to is one waiting for a person, and never longer than 14 days.</Lead>
        <div className="mt-10">
          <Lifecycle />
        </div>
      </Section>

      <Section id="kept">
        <H2>We keep what surrounds the video, not the video.</H2>
        <div className="mt-10 grid gap-4 md:grid-cols-2">
          <div className="rounded-[22px] border border-hairline bg-panel p-6">
            <p className="flex items-center gap-2.5 text-[17px] font-medium">
              <span className="inline-flex size-9 items-center justify-center rounded-lg bg-ok/12 text-ok">
                <Database {...ICON} className="size-[18px]" />
              </span>
              Kept, per customer
            </p>
            <ul className="mt-5 flex flex-col">
              {KEPT.map(({ icon: Icon, text }) => (
                <li key={text} className="flex items-center gap-3 border-t border-hairline py-3 text-[15px]">
                  <Icon {...ICON} className="size-4 shrink-0 text-muted-foreground" />
                  {text}
                </li>
              ))}
            </ul>
          </div>
          <div className="flex flex-col rounded-[22px] border border-dashed border-white/15 p-6">
            <p className="flex items-center gap-2.5 text-[17px] font-medium">
              <span className="inline-flex size-9 items-center justify-center rounded-lg bg-no/12 text-no">
                <Trash2 {...ICON} className="size-[18px]" />
              </span>
              Not kept
            </p>
            <ul className="mt-5 flex flex-col">
              {NOT_KEPT.map(({ icon: Icon, text, note }) => (
                <li key={text} className="flex items-center gap-3 border-t border-hairline py-3 text-[15px] text-muted-foreground">
                  <Icon {...ICON} className="size-4 shrink-0" />
                  <span>
                    <span className="decoration-no/60 decoration-1 [text-decoration-line:line-through]">{text}</span>
                    {note ? <span className="ml-2 font-mono text-[12px] text-foreground">{note}</span> : null}
                  </span>
                </li>
              ))}
            </ul>
            <p className="mt-auto pt-6 text-[14px] leading-relaxed text-muted-foreground">
              What we keep is never shared across customers. It is how Ormes learns your spec, and your record of every call.
            </p>
          </div>
        </div>
      </Section>

      <Section id="isolation">
        <H2>Your data stays inside your organisation.</H2>
        <Lead>Decisions, measurements and fingerprints never cross to another customer. There is no matching across customers.</Lead>
        <div className="mt-10">
          <Isolation />
        </div>
      </Section>

      <Section id="training">
        <H2>No training without opt-in.</H2>
        <Lead>Your videos train nothing unless you turn it on, and they are never resold. If you do opt in, they train Ormes’s own models only, and you pay less.</Lead>
        <div className="mt-10">
          <TrainingToggle />
        </div>
      </Section>

      <Section id="providers">
        <H2>Who processes your data.</H2>
        <div className="mt-10 overflow-x-auto rounded-[20px] border border-hairline">
          <table className="w-full min-w-[640px] text-left text-[14.5px]">
            <thead className="bg-panel font-mono text-[11.5px] uppercase tracking-[0.1em] text-muted-foreground">
              <tr>
                <th className="px-5 py-3 font-normal">Provider</th>
                <th className="px-5 py-3 font-normal">Purpose</th>
                <th className="px-5 py-3 font-normal">Data</th>
              </tr>
            </thead>
            <tbody>
              {PROVIDERS.map((p) => (
                <tr key={p.name} className="border-t border-hairline align-top">
                  <th scope="row" className="px-5 py-4 font-medium">
                    {p.name}
                    {p.optional ? <span className="ml-2 rounded border border-hairline px-1.5 text-[12px] text-muted-foreground">Off by default</span> : null}
                  </th>
                  <td className="px-5 py-4 text-muted-foreground">{p.purpose}</td>
                  <td className="px-5 py-4 text-muted-foreground">
                    {p.data}
                    {p.region ? <span className="mt-1 block font-mono text-[12.5px] text-foreground">Region: {p.region}</span> : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-8 flex flex-wrap items-center gap-x-8 gap-y-3">
          <Link href="/dpa" className="group inline-flex items-center gap-2 text-[15px] font-medium text-brand">
            <FileText {...ICON} className="size-4" /> Data processing agreement
          </Link>
          <MoreLink href="/data">Data handling</MoreLink>
        </div>
        {/* Attribution for the real footage on Home (issue #60): small, here only. */}
        <p className="mt-10 text-[12.5px] text-muted-foreground">Example footage on this site: Build AI Egocentric-10K (Apache 2.0).</p>
      </Section>

      <section className="border-t border-hairline py-20 sm:py-24">
        <div className="mx-auto flex max-w-[1160px] flex-col items-start justify-between gap-6 px-4 sm:flex-row sm:items-center sm:px-6">
          <div className="flex gap-4">
            <ShieldCheck {...ICON} className="mt-1 size-7 shrink-0 text-brand" />
            <div>
              <h2 className="text-[clamp(26px,3.4vw,36px)] font-medium tracking-[-0.02em]">Questions from your security team?</h2>
              <p className="mt-2 max-w-[56ch] text-[16px] text-muted-foreground">We answer them in writing, with the DPA. Start with a pilot on videos you already own.</p>
            </div>
          </div>
          <ButtonLink href="/signup">Start a free pilot</ButtonLink>
        </div>
      </section>
    </main>
  );
}
