import { Suspense } from "react";
import type { Metadata } from "next";
import { Skeleton } from "@/components/ui/skeleton";
import { dashboardContext } from "@/lib/dashboard";
import { listRubrics } from "@/lib/domain/rubrics";
import { listReviewQueue } from "@/lib/domain/videos";
import { ReviewWorkspace } from "./review-workspace";

export const metadata: Metadata = { title: "Review" };

export default function ReviewPage() {
  return (
    <Suspense fallback={<ReviewSkeleton />}>
      <Content />
    </Suspense>
  );
}

async function Content() {
  const { db, orgId } = await dashboardContext();
  const [items, rubrics] = await Promise.all([listReviewQueue(db, orgId), listRubrics(db, orgId)]);
  const rubricNames = Object.fromEntries(rubrics.map((r) => [r.id, r.name]));
  return <ReviewWorkspace initialItems={items} rubricNames={rubricNames} />;
}

function ReviewSkeleton() {
  return (
    <div className="grid min-h-[calc(100dvh-3.5rem)] lg:min-h-dvh lg:grid-cols-[340px_1fr]" aria-busy="true" aria-label="Loading review queue">
      <div className="hidden flex-col gap-2 border-r border-border p-4 lg:flex">
        <Skeleton className="mb-2 h-6 w-32" />
        {Array.from({ length: 7 }, (_, i) => (
          <Skeleton key={i} className="h-[68px] rounded-lg" />
        ))}
      </div>
      <div className="flex flex-col gap-5 p-4 sm:p-6 lg:p-8">
        <Skeleton className="h-6 w-56" />
        <Skeleton className="aspect-video w-full max-w-[880px] rounded-xl" />
        <Skeleton className="h-24 w-full max-w-[880px] rounded-xl" />
      </div>
    </div>
  );
}
