import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, CircleCheck, CircleX, KeyRound, ListChecks, ScanEye, Upload } from "lucide-react";
import { DocPage } from "@/components/docs/doc-page";
import { DOCS_GROUPS } from "@/components/docs/nav";
import { A, C, H2, P } from "@/components/docs/prose";
import { cn } from "@/lib/utils";

export const metadata: Metadata = {
  title: "Docs",
  description: "Integrate Ormes: upload first-person videos, apply your lab's spec as a rubric and receive accept, reject or review with reasons and measurements.",
};

const GROUP_TINT: Record<string, string> = {
  integrate: "bg-review-bg text-review-fg",
  concepts: "bg-accept-bg text-accept-fg",
  reference: "bg-muted text-foreground/80",
};

const FLOW = [
  { icon: KeyRound, label: "Authenticate", detail: "Bearer orm_live_…" },
  { icon: ListChecks, label: "Write the spec", detail: "POST /rubrics" },
  { icon: Upload, label: "Upload", detail: "POST /videos, PUT, /complete" },
  { icon: ScanEye, label: "Get the decision", detail: "video.decided" },
];

export default function DocsIndexPage() {
  return (
    <DocPage
      href="/docs"
      title="Get started"
      lead={
        <>
          Ormes applies your lab&apos;s spec to every first-person video you collect and returns <b className="font-medium text-accept-fg">accept</b>,{" "}
          <b className="font-medium text-reject-fg">reject</b> or <b className="font-medium text-review-fg">review</b>, with the reasons and every measurement. Your
          reviewers only see the doubtful cases.
        </>
      }
    >
      <section aria-label="How an integration works" className="rounded-2xl border border-border bg-subtle p-2">
        <ol className="grid gap-1 sm:grid-cols-4">
          {FLOW.map((step, i) => (
            <li key={step.label} className="relative flex items-center gap-3 rounded-xl bg-background px-3.5 py-3 shadow-[0_1px_0_rgba(11,12,14,0.04)] sm:block">
              <span className="flex items-center gap-2">
                <step.icon className="size-4 text-foreground/70" strokeWidth={1.5} aria-hidden />
                <span className="font-mono text-[11px] text-muted-foreground sm:ml-auto sm:order-last">0{i + 1}</span>
              </span>
              <span className="min-w-0 sm:mt-3 sm:block">
                <span className="block text-[14px] font-medium">{step.label}</span>
                <span className="block truncate font-mono text-[11.5px] text-muted-foreground">{step.detail}</span>
              </span>
            </li>
          ))}
        </ol>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 px-3 pb-1.5 pt-3 text-[12.5px] text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <CircleCheck className="size-3.5 text-accept-fg" strokeWidth={1.5} aria-hidden />
            accept: pay for it
          </span>
          <span className="inline-flex items-center gap-1.5">
            <CircleX className="size-3.5 text-reject-fg" strokeWidth={1.5} aria-hidden />
            reject: a critical check failed
          </span>
          <span className="inline-flex items-center gap-1.5">
            <ScanEye className="size-3.5 text-review-fg" strokeWidth={1.5} aria-hidden />
            review: a person decides
          </span>
        </div>
      </section>

      <div className="mt-12 grid gap-5">
        {DOCS_GROUPS.filter((g) => g.id !== "start").map((group) => (
          <section key={group.id} aria-labelledby={`group-${group.id}`} className="overflow-hidden rounded-2xl border border-border">
            <div className="flex items-start gap-3.5 px-5 pb-3 pt-5">
              <span className={cn("grid size-9 shrink-0 place-items-center rounded-lg", GROUP_TINT[group.id])}>
                <group.icon className="size-[18px]" strokeWidth={1.5} aria-hidden />
              </span>
              <div>
                <h2 id={`group-${group.id}`} className="text-[16px] font-semibold tracking-[-0.01em]">
                  {group.label}
                </h2>
                <p className="mt-0.5 text-[14px] text-muted-foreground">{group.description}</p>
              </div>
            </div>
            <ul className={cn("grid gap-px border-t border-border bg-border", group.items.length > 1 && "sm:grid-cols-2", group.items.length === 3 && "sm:grid-cols-3")}>
              {group.items.map((item) => (
                <li key={item.href} className="bg-background">
                  <Link href={item.href} className="group flex h-full items-start gap-3 px-5 focus-visible:outline-offset-[-2px] py-4 transition-colors hover:bg-subtle">
                    <item.icon className="mt-0.5 size-4 shrink-0 text-muted-foreground transition-colors group-hover:text-foreground" strokeWidth={1.5} aria-hidden />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5 text-[14.5px] font-medium">
                        {item.title}
                        <ArrowRight className="size-3.5 -translate-x-1 opacity-0 transition-all group-hover:translate-x-0 group-hover:opacity-100 group-focus-visible:opacity-100" strokeWidth={1.5} aria-hidden />
                      </span>
                      <span className="mt-0.5 block text-[13.5px] leading-snug text-muted-foreground">{item.description}</span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>

      <H2 id="before-you-start" className="mt-14">
        Before you start
      </H2>
      <P>
        You need an Ormes organization (<A href="/signup">start a pilot</A>), an API key from <b className="font-medium">Settings → API keys</b> in the dashboard, and the
        lab&apos;s spec for the task you collect. The API is plain HTTPS and JSON; SDKs exist for TypeScript (<C>@ormes/sdk</C>, Node 20+) and Python (<C>ormes</C>, Python
        3.10+). They are not published to npm and PyPI yet, so every example also has a cURL version.
      </P>
      <P>
        New here? The <A href="/docs/quickstart">Quickstart</A> takes you from an API key to your first decision. Then read <A href="/docs/decisions">Decisions</A> to see
        exactly when a video is rejected.
      </P>
    </DocPage>
  );
}
