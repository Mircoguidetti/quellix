import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, ArrowDownRight, ArrowUpRight, Film, Info, ListChecks, Upload } from "lucide-react";
import { EmptyState } from "@/components/app/empty-state";
import { PageContainer, PageHeader } from "@/components/app/page-header";
import { TrendChart } from "@/components/overview/trend-chart";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { dashboardContext } from "@/lib/dashboard";
import { loadOverview, REVIEW_MINUTES_PER_VIDEO, TREND_DAYS, type Overview } from "@/lib/domain/overview";
import { formatHours, formatPercent } from "@/lib/format";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Overview" };

export default function OverviewPage() {
  return (
    <PageContainer>
      <Suspense fallback={<OverviewSkeleton />}>
        <OverviewContent />
      </Suspense>
    </PageContainer>
  );
}

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

async function OverviewContent() {
  const { db, orgId, session } = await dashboardContext();
  const o = await loadOverview(db, orgId);
  const d = new Date(o.asOf);
  const today = `${WEEKDAYS[d.getUTCDay()]}, ${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;

  const header = (
    <PageHeader
      eyebrow={today}
      title="Overview"
      description={`What happened today in ${session.orgName}. Days are in UTC.`}
      actions={
        <>
          <Button asChild variant="secondary">
            <Link href="/app/upload">
              <Upload aria-hidden />
              Upload videos
            </Link>
          </Button>
          {o.waiting > 0 ? (
            <Button asChild>
              <Link href="/app/review">
                Start reviewing ({o.waiting})
                <ArrowRight aria-hidden />
              </Link>
            </Button>
          ) : (
            <Button variant="secondary" disabled>
              Review queue is empty
            </Button>
          )}
        </>
      }
    />
  );

  if (o.period.received === 0) {
    return (
      <>
        {header}
        <EmptyState
          icon={Film}
          title="No videos yet"
          description="Create a rubric from your lab's spec, then upload a few videos your reviewers have already judged. Their decisions appear here within a minute."
          action={
            <div className="flex flex-wrap justify-center gap-2">
              <Button asChild variant="secondary">
                <Link href="/app/rubrics/new">
                  <ListChecks aria-hidden />
                  Create a rubric
                </Link>
              </Button>
              <Button asChild>
                <Link href="/app/upload">
                  <Upload aria-hidden />
                  Upload videos
                </Link>
              </Button>
            </div>
          }
        />
      </>
    );
  }

  return (
    <>
      {header}
      <section aria-label="Today" className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat
          label="Videos received"
          value={String(o.today.received)}
          detail={<Delta now={o.today.received} before={o.yesterday.received} />}
        />
        <Stat
          label="Decided automatically"
          value={formatPercent(o.today.autoRate)}
          detail={o.today.decided ? `${o.today.auto} of ${o.today.decided} decided today` : "Nothing decided yet today"}
        />
        <Stat
          label="Waiting for review"
          value={String(o.waiting)}
          detail={o.waiting ? "Across all days, oldest first in Review" : "Nobody needs to watch anything"}
          href={o.waiting ? "/app/review" : undefined}
        />
        <Stat
          label="Review hours saved"
          value={formatHours(o.today.hoursSaved)}
          detail={`${formatHours(o.period.hoursSaved)} in the last ${TREND_DAYS} days`}
          hint={`Videos decided automatically × ${REVIEW_MINUTES_PER_VIDEO} min, the time a person would spend reviewing each one.`}
        />
      </section>

      <section className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader>
            <CardTitle>Last {TREND_DAYS} days</CardTitle>
            <CardDescription>
              {o.period.received.toLocaleString("en-US")} videos received · {formatPercent(o.period.autoRate)} decided automatically
            </CardDescription>
          </CardHeader>
          <CardContent>
            <TrendChart days={o.trend} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Rejections by reason</CardTitle>
            <CardDescription>Last {TREND_DAYS} days. A video can have more than one reason.</CardDescription>
          </CardHeader>
          <CardContent>
            <RejectionBars rows={o.rejections} />
          </CardContent>
        </Card>
      </section>
    </>
  );
}

function Stat({ label, value, detail, hint, href }: { label: string; value: string; detail: React.ReactNode; hint?: string; href?: string }) {
  const body = (
    <>
      <div className="flex items-center gap-1.5 font-mono text-[11.5px] uppercase tracking-[0.08em] text-muted-foreground">
        {label}
        {hint && (
          <Tooltip>
            <TooltipTrigger asChild>
              <button type="button" className="grid size-5 place-items-center rounded text-muted-foreground hover:text-foreground" aria-label={`How "${label}" is calculated`}>
                <Info className="size-3.5" aria-hidden />
              </button>
            </TooltipTrigger>
            <TooltipContent>{hint}</TooltipContent>
          </Tooltip>
        )}
      </div>
      <p className="mt-3 text-[32px] font-medium leading-none tracking-[-0.03em] [font-variant-numeric:proportional-nums]">{value}</p>
      <div className="mt-2.5 text-[13px] text-muted-foreground">{detail}</div>
    </>
  );
  return (
    <Card className={cn("p-5", href && "transition-colors hover:border-foreground/20")}>
      {href ? (
        <Link href={href} className="block rounded-md">
          {body}
        </Link>
      ) : (
        body
      )}
    </Card>
  );
}

function Delta({ now, before }: { now: number; before: number }) {
  if (!before) return <span>None yesterday</span>;
  const change = (now - before) / before;
  const up = change >= 0;
  const Icon = up ? ArrowUpRight : ArrowDownRight;
  return (
    <span className="inline-flex items-center gap-1">
      <Icon className="size-3.5" aria-hidden />
      <span className="tabular-nums">{Math.abs(Math.round(change * 100))}%</span> {up ? "more" : "fewer"} than yesterday ({before})
    </span>
  );
}

function RejectionBars({ rows }: { rows: Overview["rejections"] }) {
  if (!rows.length) return <p className="py-8 text-center text-[14px] text-muted-foreground">No rejections in this period.</p>;
  const max = Math.max(...rows.map((r) => r.count));
  return (
    <ul className="grid gap-3.5">
      {rows.map((r) => (
        <li key={r.code} className="grid gap-1.5">
          <div className="flex items-baseline justify-between gap-3 text-[13.5px]">
            <span className="truncate">{r.label}</span>
            <span className="font-mono text-[12.5px] text-muted-foreground tabular-nums">{r.count}</span>
          </div>
          <div className="h-2 rounded-full bg-muted" aria-hidden>
            <div className="h-full rounded-full bg-chart-reject" style={{ width: `${Math.max(4, (r.count / max) * 100)}%` }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

function OverviewSkeleton() {
  return (
    <div className="flex flex-col gap-6" aria-busy="true" aria-label="Loading overview">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="grid gap-2">
          <Skeleton className="h-3.5 w-36" />
          <Skeleton className="h-7 w-40" />
          <Skeleton className="h-4 w-72" />
        </div>
        <div className="flex gap-2">
          <Skeleton className="h-9 w-36 rounded-lg" />
          <Skeleton className="h-9 w-44 rounded-lg" />
        </div>
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-[134px] rounded-xl" />
        ))}
      </div>
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Skeleton className="h-[340px] rounded-xl xl:col-span-2" />
        <Skeleton className="h-[340px] rounded-xl" />
      </div>
    </div>
  );
}
