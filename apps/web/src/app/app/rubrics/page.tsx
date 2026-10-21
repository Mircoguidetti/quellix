import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { ListChecks, Plus } from "lucide-react";
import { EmptyState } from "@/components/app/empty-state";
import { PageContainer, PageHeader } from "@/components/app/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { dashboardContext } from "@/lib/dashboard";
import { listRubricSummaries } from "@/lib/domain/rubrics";
import { formatDate } from "@/lib/format";

export const metadata: Metadata = { title: "Rubrics" };

export default function RubricsPage() {
  return (
    <PageContainer>
      <PageHeader
        title="Rubrics"
        description="A rubric is your lab's spec for one task. Every save is a new version, and every decision records the version it used."
        actions={
          <Button asChild>
            <Link href="/app/rubrics/new">
              <Plus aria-hidden />
              New rubric
            </Link>
          </Button>
        }
      />
      <Suspense fallback={<ListSkeleton />}>
        <Content />
      </Suspense>
    </PageContainer>
  );
}

async function Content() {
  const { db, orgId } = await dashboardContext();
  const rubrics = await listRubricSummaries(db, orgId);
  if (!rubrics.length) {
    return (
      <EmptyState
        icon={ListChecks}
        title="No rubrics yet"
        description="Start from the dishwasher example and adjust each threshold to match what your lab accepts."
        action={
          <Button asChild>
            <Link href="/app/rubrics/new">
              <Plus aria-hidden />
              Create your first rubric
            </Link>
          </Button>
        }
      />
    );
  }
  return (
    <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
      {rubrics.map((r) => (
        <li key={r.id}>
          <Link
            href={`/app/rubrics/${r.id}`}
            className="group flex h-full flex-col gap-3 rounded-xl border border-border bg-card p-5 outline-none transition-colors hover:border-foreground/25 focus-visible:ring-2 focus-visible:ring-ring"
          >
            <div className="flex items-start justify-between gap-3">
              <h2 className="text-[15px] font-medium">{r.name}</h2>
              <Badge tone="outline">v{r.version}</Badge>
            </div>
            <p className="line-clamp-2 flex-1 text-[13.5px] text-muted-foreground">{r.description}</p>
            <div className="flex items-center justify-between gap-2 font-mono text-[11.5px] text-muted-foreground">
              <span>{r.libraryId ?? "general model"}</span>
              <span>Saved {formatDate(r.updatedAt)}</span>
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}

function ListSkeleton() {
  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3" aria-busy="true" aria-label="Loading rubrics">
      {[0, 1, 2].map((i) => (
        <Skeleton key={i} className="h-[142px] rounded-xl" />
      ))}
    </div>
  );
}
