import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, ListChecks, Plus } from "lucide-react";
import { EmptyState } from "@/components/app/empty-state";
import { PageContainer, PageHeader } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { dashboardContext } from "@/lib/dashboard";
import { listRubrics } from "@/lib/domain/rubrics";
import { UploadForm } from "./upload-form";

export const metadata: Metadata = { title: "Upload videos" };

export default function UploadPage() {
  return (
    <PageContainer className="max-w-[880px]">
      <PageHeader
        eyebrow={
          <Link href="/app/videos" className="inline-flex items-center gap-1.5 rounded hover:text-foreground">
            <ArrowLeft className="size-3.5" aria-hidden />
            Videos
          </Link>
        }
        title="Upload videos"
        description="Files go straight to encrypted storage, are analysed, then deleted. Add the lab's outcome if you already know it, to measure Quellix against it."
      />
      <Suspense fallback={<Skeleton className="h-96 rounded-xl" />}>
        <Content />
      </Suspense>
    </PageContainer>
  );
}

async function Content() {
  const { db, orgId } = await dashboardContext();
  const rubrics = (await listRubrics(db, orgId)).map((r) => ({ id: r.id, name: r.name, version: r.version }));
  if (!rubrics.length) {
    return (
      <EmptyState
        icon={ListChecks}
        title="Create a rubric first"
        description="Each video is checked against a rubric: your lab's spec for the task."
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
  return <UploadForm rubrics={rubrics} />;
}
