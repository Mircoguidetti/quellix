import { Skeleton } from "@/components/ui/skeleton";

/** Same footprint as the auth forms, so nothing jumps when the form streams in. */
export function AuthFormSkeleton({ fields = 2, extra = true }: { fields?: number; extra?: boolean }) {
  return (
    <div className="grid gap-5" aria-busy="true" aria-label="Loading">
      {Array.from({ length: fields }, (_, i) => (
        <div key={i} className="grid gap-2">
          <Skeleton className="h-3.5 w-20" />
          <Skeleton className="h-10 w-full rounded-lg" />
        </div>
      ))}
      <Skeleton className="h-11 w-full rounded-full" />
      {extra && (
        <>
          <Skeleton className="mx-auto h-3 w-8" />
          <Skeleton className="h-11 w-full rounded-full" />
        </>
      )}
    </div>
  );
}

export function NotConfigured() {
  return (
    <div role="status" className="grid gap-2 rounded-lg border border-review-fg/30 bg-review-bg p-4 text-[13.5px] leading-relaxed text-review-fg">
      <p className="font-medium">Auth is not configured</p>
      <p className="text-muted-foreground">
        This deployment has no Supabase project connected, so nobody can sign in yet. Set{" "}
        <code className="font-mono text-[12px] text-foreground">NEXT_PUBLIC_SUPABASE_URL</code> and{" "}
        <code className="font-mono text-[12px] text-foreground">NEXT_PUBLIC_SUPABASE_ANON_KEY</code>, then redeploy.
      </p>
    </div>
  );
}
