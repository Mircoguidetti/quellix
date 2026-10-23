import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ListChecks, Plus } from "lucide-react";
import { EmptyState } from "@/components/app/empty-state";
import { PageContainer, PageHeader } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { dashboardContext } from "@/lib/dashboard";
import { pilotsEnabled } from "@/lib/pilots/flag";
import { PilotWizard } from "./pilot-wizard";

export const metadata: Metadata = { title: "New pilot" };

export default function NewPilotPage() {
  return (
    <PageContainer className="max-w-[960px]">
      <PageHeader
        eyebrow={
          <Link href="/app/pilots" className="inline-flex items-center gap-1.5 rounded hover:text-foreground">
            <ArrowLeft className="size-3.5" aria-hidden />
            Pilots
          </Link>
        }
        title="New shadow pilot"
        description="Send videos your reviewers already judged. Ormes runs alongside without touching your pipeline and reports where it agrees, where it does not, and the review time it would save."
      />
      <Suspense fallback={<Skeleton className="h-[40rem] rounded-xl" />}>
        <Content />
      </Suspense>
    </PageContainer>
  );
}

async function Content() {
  if (!pilotsEnabled()) notFound();
  const { db, orgId, session } = await dashboardContext();
  if (session.role === "reviewer") {
    return <EmptyState icon={ListChecks} title="Owners and admins start pilots" description="Ask an owner or admin of your organization to start one." />;
  }
  const { data } = await db.from("rubrics").select("id, name, current_version").eq("org_id", orgId).order("name");
  const rubrics = ((data ?? []) as { id: string; name: string; current_version: number }[]).map((r) => ({ id: r.id, name: r.name, versions: r.current_version }));
  if (!rubrics.length) {
    return (
      <EmptyState
        icon={ListChecks}
        title="Create a rubric first"
        description="A pilot checks every video against one rubric version: your lab's spec for the task."
        action={
          <Button asChild>
            <Link href="/app/rubrics/new">
              <Plus aria-hidden />
              New rubric
            </Link>
          </Button>
        }
      />
    );
  }
  return <PilotWizard rubrics={rubrics} />;
}
