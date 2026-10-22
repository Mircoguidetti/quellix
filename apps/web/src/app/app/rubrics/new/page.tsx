import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, FileUp } from "lucide-react";
import example from "@quellix/contracts/examples/rubric.load_dishwasher.json";
import { PageContainer, PageHeader } from "@/components/app/page-header";
import { Card } from "@/components/ui/card";
import { dashboardContext } from "@/lib/dashboard";
import { recentDecisionChecks } from "@/lib/domain/rubrics";
import { SPEC_LIBRARY, findTemplate } from "@/lib/spec-library";
import { cn } from "@/lib/utils";
import { EditorSkeleton } from "../editor-skeleton";
import { RubricEditor } from "../rubric-editor";

export const metadata: Metadata = { title: "New rubric" };

export default function NewRubricPage({ searchParams }: PageProps<"/app/rubrics/new">) {
  return (
    <PageContainer>
      <PageHeader
        eyebrow={
          <Link href="/app/rubrics" className="inline-flex items-center gap-1.5 rounded hover:text-foreground">
            <ArrowLeft className="size-3.5" aria-hidden />
            Rubrics
          </Link>
        }
        title="New rubric"
        description="Start from a ready rubric, import the lab's spec, or edit the example. Change every field to match your lab's spec."
      />
      <Suspense fallback={<EditorSkeleton />}>
        <Content searchParams={searchParams} />
      </Suspense>
    </PageContainer>
  );
}

async function Content({ searchParams }: { searchParams: PageProps<"/app/rubrics/new">["searchParams"] }) {
  const raw = (await searchParams).template;
  const template = findTemplate(Array.isArray(raw) ? raw[0] : raw);
  const { db, orgId, session } = await dashboardContext();
  const { scope, rows } = await recentDecisionChecks(db, orgId, null);
  const initial = template?.rubric ?? { name: example.name.replace(" (example)", ""), task: example.task, checks: example.checks };
  return (
    <>
      <nav aria-label="Start from" className="grid gap-2">
        <h2 className="font-mono text-[11.5px] uppercase tracking-[0.08em] text-muted-foreground">Start from</h2>
        <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          <li>
            <Link
              href="/app/rubrics/import"
              className="flex h-full items-start gap-2.5 rounded-lg border border-dashed border-border p-3 text-[13.5px] transition-colors hover:bg-subtle"
            >
              <FileUp className="mt-0.5 size-4 shrink-0" aria-hidden />
              <span>
                <span className="block font-medium">Import the lab&apos;s spec</span>
                <span className="text-muted-foreground">Paste text or a PDF; every value is cited to its line.</span>
              </span>
            </Link>
          </li>
          {SPEC_LIBRARY.map((t) => (
            <li key={t.id}>
              <Link
                href={{ pathname: "/app/rubrics/new", query: { template: t.id } }}
                aria-current={template?.id === t.id ? "true" : undefined}
                className={cn(
                  "block h-full rounded-lg border border-border p-3 text-[13.5px] transition-colors hover:bg-subtle",
                  template?.id === t.id && "border-foreground/40 bg-subtle",
                )}
              >
                <span className="block font-medium">{t.title}</span>
                <span className="text-muted-foreground">{t.summary}</span>
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      {template && template.unsupported.length > 0 && (
        <Card className="grid gap-1.5 p-4 text-[13.5px]">
          <p className="font-medium">Not checked by Ormes yet, but common in specs like this:</p>
          <ul className="list-disc pl-5 text-muted-foreground">
            {template.unsupported.map((u) => (
              <li key={u}>{u}</li>
            ))}
          </ul>
        </Card>
      )}
      <RubricEditor
        key={template?.id ?? "example"}
        rubricId={null}
        currentVersion={null}
        initial={initial}
        history={[]}
        samples={rows}
        sampleScope={scope}
        canEdit={session.role !== "reviewer"}
      />
    </>
  );
}
