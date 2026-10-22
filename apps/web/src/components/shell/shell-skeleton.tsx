import { Logo } from "@/components/logo";
import { Skeleton } from "@/components/ui/skeleton";
import { NAV } from "./nav";

/** What the app looks like while the session loads: same frame, no layout shift. */
export function ShellSkeleton({ collapsed = false, children }: { collapsed?: boolean; children?: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh bg-background" aria-busy="true">
      <aside className={`dark sticky top-0 hidden h-dvh shrink-0 flex-col self-start border-r border-border bg-background text-foreground lg:flex ${collapsed ? "w-[68px]" : "w-[248px]"}`}>
        <div className="flex h-14 items-center pl-4">{!collapsed && <Logo className="text-[14px]" />}</div>
        <div className="px-3 pb-3">
          <Skeleton className="h-[42px] w-full rounded-lg" />
        </div>
        <div className="flex flex-col gap-0.5 px-3">
          {NAV.filter((n) => !n.flag).map((n) => (
            <div key={n.href} className="flex h-9 items-center gap-3 px-2.5">
              <Skeleton className="size-[18px] rounded" />
              {!collapsed && <Skeleton className="h-3 w-20" />}
            </div>
          ))}
        </div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="dark h-14 border-b border-border bg-background lg:hidden" />
        {children ?? <PageSkeleton />}
      </div>
    </div>
  );
}

export function PageSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className="mx-auto flex w-full max-w-[1240px] flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8 lg:py-8" aria-busy="true" aria-label="Loading">
      <div className="grid gap-2">
        <Skeleton className="h-7 w-48" />
        <Skeleton className="h-4 w-80 max-w-full" />
      </div>
      <div className="grid gap-3">
        {Array.from({ length: rows }, (_, i) => (
          <Skeleton key={i} className="h-12 w-full rounded-lg" />
        ))}
      </div>
    </div>
  );
}
