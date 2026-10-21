import { Skeleton } from "@/components/ui/skeleton";

export function EditorSkeleton() {
  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]" aria-busy="true" aria-label="Loading rubric">
      <div className="grid content-start gap-4">
        <Skeleton className="h-[300px] rounded-xl" />
        <Skeleton className="h-[180px] rounded-xl" />
        <Skeleton className="h-[240px] rounded-xl" />
      </div>
      <div className="grid content-start gap-4">
        <Skeleton className="h-[130px] rounded-xl" />
        <Skeleton className="h-[320px] rounded-xl" />
      </div>
    </div>
  );
}
