import { Suspense } from "react";
import { cookies } from "next/headers";
import { AppShell } from "@/components/shell/app-shell";
import { ShellSkeleton } from "@/components/shell/shell-skeleton";
import { isDemoMode } from "@/lib/demo/mode";
import { countReviewQueue } from "@/lib/domain/videos";
import { dashboardContext } from "@/lib/dashboard";
import { pilotsEnabled } from "@/lib/pilots/flag";

export default function AppLayout({ children }: LayoutProps<"/app">) {
  return (
    <Suspense fallback={<ShellSkeleton />}>
      <Shell>{children}</Shell>
    </Suspense>
  );
}

async function Shell({ children }: { children: React.ReactNode }) {
  const [{ session, db, orgId }, jar] = await Promise.all([dashboardContext(), cookies()]);
  const reviewCount = await countReviewQueue(db, orgId).catch(() => 0);
  const current = { orgId: session.orgId, orgName: session.orgName, role: session.role };
  return (
    <AppShell
      user={{ name: session.name, email: session.email }}
      org={current}
      memberships={session.memberships}
      reviewCount={reviewCount}
      initialCollapsed={jar.get("qx_sidebar")?.value === "collapsed"}
      demo={isDemoMode()}
      pilots={pilotsEnabled()}
    >
      {children}
    </AppShell>
  );
}
