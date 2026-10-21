import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { PageContainer } from "@/components/app/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { VideoReport } from "@/components/video/video-report";
import { ApiError } from "@/lib/api/errors";
import { dashboardContext } from "@/lib/dashboard";
import { listRubrics } from "@/lib/domain/rubrics";
import { getVideoItem } from "@/lib/domain/videos";
import { ReportSide } from "./report-side";

export const metadata: Metadata = { title: "Video report" };

export default function VideoReportPage({ params }: PageProps<"/app/videos/[id]">) {
  return (
    <PageContainer className="max-w-[1240px]">
      <Link href="/app/videos" className="inline-flex w-fit items-center gap-1.5 rounded text-[13px] text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-3.5" aria-hidden />
        All videos
      </Link>
      <Suspense fallback={<ReportSkeleton />}>
        <Content params={params} />
      </Suspense>
    </PageContainer>
  );
}

async function Content({ params }: { params: PageProps<"/app/videos/[id]">["params"] }) {
  const { id } = await params;
  const { db, orgId } = await dashboardContext();
  const [item, rubrics] = await Promise.all([
    getVideoItem(db, orgId, id).catch((e) => {
      if (e instanceof ApiError && e.status === 404) notFound();
      throw e;
    }),
    listRubrics(db, orgId),
  ]);
  const rubricName = rubrics.find((r) => r.id === item.video.rubric_id)?.name;
  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_320px]">
      <VideoReport item={item} rubricName={rubricName} headingLevel={1} />
      <ReportSide
        videoId={item.video.id}
        decision={item.video.decision?.decision ?? null}
        review={item.video.review ? { decision: item.video.review.decision, note: item.video.review.note ?? null } : null}
        lab={item.video.lab_outcome ? { outcome: item.video.lab_outcome.outcome as "accept" | "reject", reason: item.video.lab_outcome.reason ?? "" } : null}
      />
    </div>
  );
}

function ReportSkeleton() {
  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_320px]" aria-busy="true" aria-label="Loading video">
      <div className="grid gap-5">
        <Skeleton className="h-6 w-56" />
        <Skeleton className="aspect-video w-full rounded-xl" />
        <Skeleton className="h-32 w-full rounded-xl" />
      </div>
      <div className="grid content-start gap-4">
        <Skeleton className="h-40 rounded-xl" />
        <Skeleton className="h-48 rounded-xl" />
      </div>
    </div>
  );
}
