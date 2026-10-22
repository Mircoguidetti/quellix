import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { ZodError } from "zod";
import { ClipboardList, Download, TriangleAlert } from "lucide-react";
import { EmptyState } from "@/components/app/empty-state";
import { PageContainer, PageHeader } from "@/components/app/page-header";
import { Badge, toneFor } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ApiError } from "@/lib/api/errors";
import { dashboardContext } from "@/lib/dashboard";
import { type AuditGroup, type AuditQuery, type AuditReport, loadAudit, parseAuditQuery, resolveWindow } from "@/lib/domain/audit";
import { formatDate, formatPercent } from "@/lib/format";
import { AuditFilters } from "./audit-filters";

export const metadata: Metadata = { title: "Audit export" };

export default function AuditPage({ searchParams }: PageProps<"/app/audit">) {
  return (
    <PageContainer>
      <Suspense fallback={<AuditSkeleton />}>
        <Content searchParams={searchParams} />
      </Suspense>
    </PageContainer>
  );
}

function AuditSkeleton() {
  return (
    <div className="grid gap-6">
      <Skeleton className="h-14 w-80 rounded-lg" />
      <Skeleton className="h-20 rounded-xl" />
      <Skeleton className="h-96 rounded-xl" />
    </div>
  );
}

const DESCRIPTION =
  "What labs ask for in procurement: per rubric version, how each check performed, why videos were rejected, how often a person checked an automatic decision and what they changed. Days are in UTC.";

async function Content({ searchParams }: { searchParams: PageProps<"/app/audit">["searchParams"] }) {
  const sp = await searchParams;
  const { db, orgId } = await dashboardContext();
  const rubricsRes = await db.from("rubrics").select("id, name, current_version").eq("org_id", orgId).order("name");
  const rubrics = ((rubricsRes.data ?? []) as { id: string; name: string; current_version: number }[]).map((r) => ({
    id: r.id,
    name: r.name,
    versions: r.current_version,
  }));

  let query: AuditQuery | null = null;
  let report: AuditReport | null = null;
  let problem: string | null = null;
  try {
    query = parseAuditQuery(sp);
    report = await loadAudit(db, orgId, query);
  } catch (err) {
    if (err instanceof ZodError) problem = err.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    else if (err instanceof ApiError && err.status < 500) problem = err.message;
    else throw err;
  }

  const fallback = resolveSafe(query);
  const filters = {
    from: report?.window.from ?? fallback.from,
    to: report?.window.to ?? fallback.to,
    rubric_id: query?.rubric_id,
    version: query?.version,
  };
  const exportHref = (format: "csv" | "json") => {
    const p = new URLSearchParams({ from: filters.from, to: filters.to, format });
    if (filters.rubric_id) p.set("rubric_id", filters.rubric_id);
    if (filters.version) p.set("version", String(filters.version));
    return `/app/audit/export?${p}`;
  };

  return (
    <>
      <PageHeader
        title="Audit export"
        description={DESCRIPTION}
        actions={
          report ? (
            <>
              <Button asChild variant="secondary">
                <a href={exportHref("csv")} download>
                  <Download aria-hidden />
                  Download CSV
                </a>
              </Button>
              <Button asChild variant="secondary">
                <a href={exportHref("json")} download>
                  <Download aria-hidden />
                  Download JSON
                </a>
              </Button>
            </>
          ) : undefined
        }
      />
      <AuditFilters rubrics={rubrics} value={filters} />
      {problem ? (
        <div role="alert" className="flex items-start gap-3 rounded-xl border border-border bg-subtle p-4 text-[14px]">
          <TriangleAlert className="mt-0.5 size-4 shrink-0 text-reject-fg" aria-hidden />
          <p>{problem}</p>
        </div>
      ) : report && report.groups.length === 0 ? (
        <EmptyState
          icon={ClipboardList}
          title="No videos in this window"
          description="Choose other dates or another rubric. The export counts videos by the day they were received."
        />
      ) : (
        report && (
          <div className="grid gap-6">
            <p className="text-[13px] text-muted-foreground">
              {report.groups.length} rubric version{report.groups.length === 1 ? "" : "s"}, videos received {formatDate(`${report.window.from}T00:00:00Z`)} to{" "}
              {formatDate(`${report.window.to}T00:00:00Z`)}. The API returns the same report: <code className="font-mono text-[12.5px]">GET /api/v1/audit</code>.
            </p>
            {report.groups.map((g) => (
              <GroupCard key={`${g.rubric.id}@${g.rubric.version}`} g={g} />
            ))}
          </div>
        )
      )}
    </>
  );
}

function resolveSafe(query: AuditQuery | null) {
  try {
    return resolveWindow(query ?? {});
  } catch {
    return resolveWindow({});
  }
}

function Stat({ label, value, hint }: { label: string; value: React.ReactNode; hint?: string }) {
  return (
    <div className="grid content-start gap-0.5">
      <dt className="text-[12.5px] text-muted-foreground">{label}</dt>
      <dd className="font-mono text-[18px] tabular-nums">{value}</dd>
      {hint && <dd className="text-[12px] text-muted-foreground">{hint}</dd>}
    </div>
  );
}

function GroupCard({ g }: { g: AuditGroup }) {
  const automatic = g.videos.accept + g.videos.reject;
  const id = `audit-${g.rubric.id}-${g.rubric.version}`;
  return (
    <Card aria-labelledby={id}>
      <CardHeader>
        <CardTitle id={id} className="flex flex-wrap items-center gap-2">
          <Link href={`/app/rubrics/${g.rubric.id}`} className="hover:underline">
            {g.rubric.name}
          </Link>
          <Badge tone="outline" className="font-mono">
            v{g.rubric.version}
          </Badge>
        </CardTitle>
        <CardDescription>
          {g.videos.received} received · {g.videos.decided} decided
          {g.videos.not_decided ? ` · ${g.videos.not_decided} not decided yet` : ""}
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-6">
        <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
          <Stat label="Accepted" value={g.videos.accept} />
          <Stat label="Rejected" value={g.videos.reject} />
          <Stat label="Sent to review" value={g.videos.review} hint={`${formatPercent(g.human_review.routed_rate)} of decided`} />
          <Stat label="Automatic" value={formatPercent(g.automatic_rate)} hint={`${automatic} decided without a person`} />
          <Stat label="Sampling rate" value={formatPercent(g.human_review.sampling_rate)} hint={`${g.human_review.automatic_sampled} automatic decisions checked`} />
          <Stat label="Overrides" value={g.overrides.total} hint={g.overrides.rate === null ? "none checked" : `${formatPercent(g.overrides.rate)} of checked`} />
        </dl>

        <section aria-label={`Checks, ${g.rubric.name} v${g.rubric.version}`} className="grid gap-2">
          <h3 className="text-[14px] font-medium">Pass rate per check</h3>
          {g.checks.length === 0 ? (
            <p className="text-[13.5px] text-muted-foreground">No checks recorded yet.</p>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-border">
              <Table>
                <TableHeader className="bg-subtle">
                  <TableRow>
                    <TableHead>Check</TableHead>
                    <TableHead className="text-right">Pass rate</TableHead>
                    <TableHead className="hidden text-right sm:table-cell">Pass</TableHead>
                    <TableHead className="text-right">Fail</TableHead>
                    <TableHead className="hidden text-right sm:table-cell">Uncertain</TableHead>
                    <TableHead className="hidden text-right sm:table-cell">Error</TableHead>
                    <TableHead className="hidden text-right sm:table-cell">Skipped</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {g.checks.map((c) => (
                    <TableRow key={c.check}>
                      <TableCell className="whitespace-normal">
                        {c.label}
                        <span className="block text-[12.5px] text-muted-foreground sm:hidden">
                          {[`${c.pass} pass`, c.uncertain && `${c.uncertain} uncertain`, c.error && `${c.error} error`, c.skipped && `${c.skipped} skipped`]
                            .filter(Boolean)
                            .join(" · ")}
                        </span>
                      </TableCell>
                      <TableCell className="text-right font-mono tabular-nums">{formatPercent(c.pass_rate)}</TableCell>
                      <TableCell className="hidden text-right font-mono tabular-nums sm:table-cell">{c.pass}</TableCell>
                      <TableCell className="text-right font-mono tabular-nums">{c.fail}</TableCell>
                      <TableCell className="hidden text-right font-mono tabular-nums sm:table-cell">{c.uncertain}</TableCell>
                      <TableCell className="hidden text-right font-mono tabular-nums sm:table-cell">{c.error}</TableCell>
                      <TableCell className="hidden text-right font-mono tabular-nums sm:table-cell">{c.skipped}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </section>

        <div className="grid gap-6 lg:grid-cols-2">
          <CodeTable title="Rejection codes" empty="No rejections." rows={g.rejection_codes} />
          <CodeTable title="Reasons sent to review" empty="Nothing sent to review." rows={g.review_codes} />
        </div>

        <section aria-label={`Reviewer overrides, ${g.rubric.name} v${g.rubric.version}`} className="grid gap-2">
          <h3 className="text-[14px] font-medium">Reviewer overrides</h3>
          <p className="text-[13px] text-muted-foreground">
            Review cases resolved: {g.human_review.review_resolved_accept} accepted, {g.human_review.review_resolved_reject} rejected
            {g.human_review.review_pending ? `, ${g.human_review.review_pending} waiting` : ""}. Automatic decisions changed by a person: {g.overrides.accept_to_reject}{" "}
            accept → reject, {g.overrides.reject_to_accept} reject → accept.
          </p>
          {g.overrides.items.length > 0 && (
            <div className="overflow-x-auto rounded-lg border border-border">
              <Table>
                <TableHeader className="bg-subtle">
                  <TableRow>
                    <TableHead>Video</TableHead>
                    <TableHead>Change</TableHead>
                    <TableHead className="hidden md:table-cell">Note</TableHead>
                    <TableHead className="hidden text-right sm:table-cell">Reviewed</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {g.overrides.items.map((o) => (
                    <TableRow key={o.video_id}>
                      <TableCell className="whitespace-normal align-top md:align-middle">
                        <Link href={`/app/videos/${o.video_id}`} className="font-mono text-[13px] hover:underline">
                          {o.external_id ?? o.video_id.slice(0, 8)}
                        </Link>
                        <span className="block font-mono text-[12px] text-muted-foreground sm:hidden">{formatDate(o.reviewed_at)}</span>
                        <span className="block text-[12.5px] text-muted-foreground md:hidden">{o.note || "No note"}</span>
                      </TableCell>
                      <TableCell className="whitespace-nowrap px-2 align-top sm:px-4 md:align-middle">
                        <Badge tone={toneFor(o.automatic)}>{o.automatic}</Badge> → <Badge tone={toneFor(o.final)}>{o.final}</Badge>
                      </TableCell>
                      <TableCell className="hidden min-w-[14rem] text-[13.5px] text-muted-foreground md:table-cell">{o.note || "No note"}</TableCell>
                      <TableCell className="hidden whitespace-nowrap text-right align-top font-mono text-[12.5px] text-muted-foreground sm:table-cell md:align-middle">
                        {formatDate(o.reviewed_at)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </section>
      </CardContent>
    </Card>
  );
}

function CodeTable({ title, empty, rows }: { title: string; empty: string; rows: AuditGroup["rejection_codes"] }) {
  return (
    <section className="grid content-start gap-2" aria-label={title}>
      <h3 className="text-[14px] font-medium">{title}</h3>
      {rows.length === 0 ? (
        <p className="text-[13.5px] text-muted-foreground">{empty}</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <Table>
            <TableHeader className="bg-subtle">
              <TableRow>
                <TableHead>Reason</TableHead>
                <TableHead className="hidden sm:table-cell">Code</TableHead>
                <TableHead className="text-right">Videos</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.code}>
                  <TableCell className="whitespace-normal">
                    {r.label}
                    <span className="block break-all font-mono text-[12px] text-muted-foreground sm:hidden">{r.code}</span>
                  </TableCell>
                  <TableCell className="hidden font-mono text-[12.5px] text-muted-foreground sm:table-cell">{r.code}</TableCell>
                  <TableCell className="text-right font-mono tabular-nums">{r.count}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </section>
  );
}

