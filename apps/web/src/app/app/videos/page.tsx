import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { ChevronLeft, ChevronRight, Film, SearchX, Upload } from "lucide-react";
import { DecisionBadge } from "@/components/app/decision-badge";
import { EmptyState } from "@/components/app/empty-state";
import { PageContainer, PageHeader } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { dashboardContext } from "@/lib/dashboard";
import { listRubrics } from "@/lib/domain/rubrics";
import { failureReasons, listVideoItems } from "@/lib/domain/videos";
import { explainStatus, formatDateTime } from "@/lib/format";
import { rangeStart, videosQuerySchema, type VideosQuery } from "./params";
import { VideoFilters } from "./video-filters";

export const metadata: Metadata = { title: "Videos" };

const PAGE_SIZE = 25;

export default function VideosPage({ searchParams }: PageProps<"/app/videos">) {
  return (
    <PageContainer>
      <PageHeader
        title="Videos"
        description="Every video received, with its decision. Open one to see the reasons and measurements."
        actions={
          <Button asChild>
            <Link href="/app/upload">
              <Upload aria-hidden />
              Upload videos
            </Link>
          </Button>
        }
      />
      <Suspense fallback={<TableSkeleton />}>
        <Content searchParams={searchParams} />
      </Suspense>
    </PageContainer>
  );
}

async function Content({ searchParams }: { searchParams: PageProps<"/app/videos">["searchParams"] }) {
  const query = videosQuerySchema.parse(await searchParams);
  const { db, orgId } = await dashboardContext();
  const rubrics = await listRubrics(db, orgId);
  const { items, next_cursor } = await listVideoItems(db, orgId, {
    limit: PAGE_SIZE,
    decision: query.decision,
    status: query.status,
    rubricId: query.rubric,
    createdFrom: rangeStart(query.range),
    search: query.q,
    cursor: query.cursor,
  }).catch((e) => {
    // A tampered cursor: start again from the first page rather than failing.
    if (query.cursor) return { items: [], next_cursor: null };
    throw e;
  });
  const names = new Map(rubrics.map((r) => [r.id, r.name]));
  const failures = await failureReasons(db, items.filter((i) => i.view.status === "failed").map((i) => i.view.id));
  const filtered = Boolean(query.decision || query.status || query.rubric || query.range || query.q);
  const prev = query.prev ? query.prev.split(",").filter(Boolean) : [];
  const page = prev.length + (query.cursor ? 1 : 0) + 1;

  return (
    <div className="grid gap-4">
      <VideoFilters query={query} rubrics={rubrics.map((r) => ({ id: r.id, name: r.name }))} />
      {items.length === 0 ? (
        filtered ? (
          <EmptyState
            icon={SearchX}
            title="No videos match these filters"
            description="Try a wider date range or clear the filters."
            action={
              <Button asChild variant="secondary">
                <Link href="/app/videos">Clear filters</Link>
              </Button>
            }
          />
        ) : (
          <EmptyState
            icon={Film}
            title="No videos yet"
            description="Upload videos here or send them with the API. Each one gets a decision with its reasons in under a minute."
            action={
              <Button asChild>
                <Link href="/app/upload">
                  <Upload aria-hidden />
                  Upload videos
                </Link>
              </Button>
            }
          />
        )
      ) : (
        <>
          <div className="overflow-hidden rounded-xl border border-border">
            <Table>
              <TableHeader className="bg-subtle">
                <TableRow>
                  <TableHead>Video</TableHead>
                  <TableHead>Decision</TableHead>
                  <TableHead className="hidden md:table-cell">Status</TableHead>
                  <TableHead className="hidden lg:table-cell">Rubric</TableHead>
                  <TableHead className="hidden lg:table-cell">Contributor</TableHead>
                  <TableHead className="hidden text-right sm:table-cell">Received</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map(({ view, row }) => (
                  <TableRow key={view.id} className="relative hover:bg-subtle focus-within:bg-subtle">
                    <TableCell className="max-w-[16rem]">
                      <Link
                        href={`/app/videos/${view.id}`}
                        className="font-mono text-[13px] font-medium outline-none after:absolute after:inset-0 focus-visible:after:rounded-md focus-visible:after:ring-2 focus-visible:after:ring-inset focus-visible:after:ring-ring"
                      >
                        {view.external_id ?? view.id.slice(0, 8)}
                      </Link>
                      {row.filename && <span className="hidden truncate text-[12px] text-muted-foreground sm:block">{row.filename}</span>}
                      <span className="block font-mono text-[11.5px] text-muted-foreground sm:hidden">{formatDateTime(view.created_at)}</span>
                    </TableCell>
                    <TableCell>
                      <span className="flex items-center gap-2">
                        <DecisionBadge value={view.decision?.decision} status={view.status} error={failures.get(view.id)} />
                        {view.review && <span className="text-[12px] text-muted-foreground">reviewed: {view.review.decision}</span>}
                      </span>
                    </TableCell>
                    <TableCell className="hidden text-[13px] text-muted-foreground md:table-cell">{explainStatus(view.status)}</TableCell>
                    <TableCell className="hidden text-[13px] lg:table-cell">
                      {names.get(view.rubric_id) ?? "Rubric"} <span className="font-mono text-[12px] text-muted-foreground">v{view.rubric_version}</span>
                    </TableCell>
                    <TableCell className="hidden font-mono text-[12.5px] text-muted-foreground lg:table-cell">{row.contributor_ref ?? "—"}</TableCell>
                    <TableCell className="hidden text-right font-mono text-[12.5px] text-muted-foreground tabular-nums sm:table-cell">{formatDateTime(view.created_at)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <Pagination query={query} prev={prev} next={next_cursor} page={page} shown={items.length} />
        </>
      )}
    </div>
  );
}

function href(query: VideosQuery, patch: Partial<VideosQuery>) {
  const merged = { ...query, ...patch };
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(merged)) if (v) params.set(k, String(v));
  const s = params.toString();
  return s ? `/app/videos?${s}` : "/app/videos";
}

function Pagination({ query, prev, next, page, shown }: { query: VideosQuery; prev: string[]; next: string | null; page: number; shown: number }) {
  const hasPrev = Boolean(query.cursor);
  const prevHref = hasPrev
    ? href(query, { cursor: prev.at(-1) || undefined, prev: prev.slice(0, -1).join(",") || undefined })
    : null;
  const nextHref = next ? href(query, { cursor: next, prev: [...prev, ...(query.cursor ? [query.cursor] : [])].join(",") || undefined }) : null;
  const start = (page - 1) * PAGE_SIZE + 1;
  return (
    <nav aria-label="Pagination" className="flex items-center justify-between gap-3 text-[13px] text-muted-foreground">
      <span className="tabular-nums">
        {start}–{start + shown - 1}
        {next ? "" : ` of ${start + shown - 1}`}
      </span>
      <div className="flex gap-2">
        {prevHref ? (
          <Button asChild variant="secondary" size="sm">
            <Link href={prevHref}>
              <ChevronLeft aria-hidden />
              Newer
            </Link>
          </Button>
        ) : (
          <Button variant="secondary" size="sm" disabled>
            <ChevronLeft aria-hidden />
            Newer
          </Button>
        )}
        {nextHref ? (
          <Button asChild variant="secondary" size="sm">
            <Link href={nextHref}>
              Older
              <ChevronRight aria-hidden />
            </Link>
          </Button>
        ) : (
          <Button variant="secondary" size="sm" disabled>
            Older
            <ChevronRight aria-hidden />
          </Button>
        )}
      </div>
    </nav>
  );
}

function TableSkeleton() {
  return (
    <div className="grid gap-4" aria-busy="true" aria-label="Loading videos">
      <div className="flex flex-wrap gap-2">
        <Skeleton className="h-9 w-64 rounded-lg" />
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-9 w-36 rounded-lg" />
        ))}
      </div>
      <div className="overflow-hidden rounded-xl border border-border">
        <Skeleton className="h-10 rounded-none" />
        {Array.from({ length: 10 }, (_, i) => (
          <div key={i} className="flex h-[58px] items-center gap-6 border-t border-border px-4">
            <Skeleton className="h-4 w-28" />
            <Skeleton className="h-5 w-16" />
            <Skeleton className="hidden h-4 w-20 md:block" />
            <Skeleton className="ml-auto h-4 w-32" />
          </div>
        ))}
      </div>
    </div>
  );
}
