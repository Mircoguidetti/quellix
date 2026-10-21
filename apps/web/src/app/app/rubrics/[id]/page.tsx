import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { PageContainer, PageHeader } from "@/components/app/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { ApiError } from "@/lib/api/errors";
import { dashboardContext } from "@/lib/dashboard";
import { listRubricHistory, recentDecisionChecks } from "@/lib/domain/rubrics";
import { EditorSkeleton } from "../editor-skeleton";
import { RubricEditor } from "../rubric-editor";

export const metadata: Metadata = { title: "Edit rubric" };

export default function EditRubricPage({ params }: PageProps<"/app/rubrics/[id]">) {
  return (
    <PageContainer>
      <Suspense
        fallback={
          <>
            <div className="grid gap-2">
              <Skeleton className="h-3.5 w-20" />
              <Skeleton className="h-7 w-64" />
            </div>
            <EditorSkeleton />
          </>
        }
      >
        <Content params={params} />
      </Suspense>
    </PageContainer>
  );
}

async function Content({ params }: { params: PageProps<"/app/rubrics/[id]">["params"] }) {
  const { id } = await params;
  const { db, orgId, session } = await dashboardContext();
  const history = await listRubricHistory(db, orgId, id).catch((e) => {
    if (e instanceof ApiError && e.status === 404) notFound();
    throw e;
  });
  const current = history[0];
  if (!current) notFound();
  const { scope, rows } = await recentDecisionChecks(db, orgId, id);
  return (
    <>
      <PageHeader
        eyebrow={
          <Link href="/app/rubrics" className="inline-flex items-center gap-1.5 rounded hover:text-foreground">
            <ArrowLeft className="size-3.5" aria-hidden />
            Rubrics
          </Link>
        }
        title={current.body.name}
        description={`Version ${current.version} of ${history.length}. Change thresholds and watch the preview before saving.`}
      />
      <RubricEditor
        rubricId={id}
        currentVersion={current.version}
        initial={current.body}
        history={history}
        samples={rows}
        sampleScope={scope}
        canEdit={session.role !== "reviewer"}
      />
    </>
  );
}
