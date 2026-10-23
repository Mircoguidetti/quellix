import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, CircleCheck, CircleHelp, CircleX, Download, Hourglass } from "lucide-react";
import { PageContainer, PageHeader } from "@/components/app/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ApiError } from "@/lib/api/errors";
import { dashboardContext } from "@/lib/dashboard";
import { loadPilotReport } from "@/lib/domain/pilots";
import { formatDate, formatPercent } from "@/lib/format";
import { pilotsEnabled } from "@/lib/pilots/flag";
import { METRICS, type PilotReport, type Verdict } from "@/lib/pilots/report";
import { cn } from "@/lib/utils";
import { AutoRefresh } from "./auto-refresh";

export const metadata: Metadata = { title: "Pilot report" };

export default function PilotPage({ params }: PageProps<"/app/pilots/[id]">) {
  return (
    <PageContainer>
      <Suspense fallback={<Skeleton className="h-[36rem] rounded-xl" />}>
        <Content params={params} />
      </Suspense>
    </PageContainer>
  );
}

const VERDICT = {
  pass: { title: "Pass", text: "Every success criterion is met.", icon: CircleCheck, tone: "border-accept-fg/40 bg-accept-bg text-accept-fg" },
  fail: { title: "Fail", text: "At least one success criterion is not met.", icon: CircleX, tone: "border-reject-fg/40 bg-reject-bg text-reject-fg" },
  not_measurable: { title: "Not measurable", text: "Some criteria need data this pilot does not have.", icon: CircleHelp, tone: "border-border bg-subtle text-foreground" },
  provisional: { title: "Provisional", text: "Videos are still being analysed; the verdict can change.", icon: Hourglass, tone: "border-border bg-subtle text-foreground" },
} as const;

const RESULT: Record<Verdict, { label: string; tone: "accept" | "reject" | "neutral" }> = {
  pass: { label: "pass", tone: "accept" },
  fail: { label: "fail", tone: "reject" },
  not_measurable: { label: "not measurable", tone: "neutral" },
};

async function Content({ params }: { params: PageProps<"/app/pilots/[id]">["params"] }) {
  if (!pilotsEnabled()) notFound();
  const { id } = await params;
  const { db, orgId } = await dashboardContext();
  let data;
  try {
    data = await loadPilotReport(db, orgId, id);
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) notFound();
    throw e;
  }
  const { pilot, report, awaitingFiles } = data;
  const v = VERDICT[report.verdict];
  const VIcon = v.icon;
  const m = report.metrics;

  return (
    <>
      {report.status === "running" && <AutoRefresh seconds={5} />}
      <PageHeader
        eyebrow={
          <Link href="/app/pilots" className="inline-flex items-center gap-1.5 rounded hover:text-foreground">
            <ArrowLeft className="size-3.5" aria-hidden />
            Pilots
          </Link>
        }
        title={pilot.name}
        description={`Shadow pilot on ${pilot.rubric_name} v${pilot.rubric_version}, started ${formatDate(pilot.created_at)}. No webhooks were sent and nothing reached contributors.`}
        actions={
          <>
            <Button asChild variant="secondary">
              <a href={`/app/pilots/${pilot.id}/export?format=pdf`} download>
                <Download aria-hidden />
                Download PDF
              </a>
            </Button>
            <Button asChild variant="secondary">
              <a href={`/app/pilots/${pilot.id}/export?format=csv`} download>
                <Download aria-hidden />
                Download CSV
              </a>
            </Button>
          </>
        }
      />

      <section aria-labelledby="verdict" className={cn("grid gap-4 rounded-xl border p-5", v.tone)}>
        <div className="flex flex-wrap items-center gap-3">
          <VIcon className="size-6" aria-hidden />
          <h2 id="verdict" className="text-[20px] font-medium">
            {v.title}
          </h2>
          <p className="text-[14px] text-foreground">{v.text}</p>
        </div>
        <ul className="grid gap-2 text-foreground" aria-label="Success criteria, agreed before the run">
          {report.criteria.map((c, i) => (
            <li key={i} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 rounded-lg bg-background/70 px-3 py-2">
              <Badge tone={RESULT[c.verdict].tone}>{RESULT[c.verdict].label}</Badge>
              <span className="text-[14px]">{c.description}</span>
              <span className="text-[13px] text-muted-foreground">{c.detail}</span>
            </li>
          ))}
        </ul>
      </section>

      <p className="text-[13.5px] text-muted-foreground" aria-live="polite">
        {report.counts.decided} of {report.counts.videos} videos analysed
        {report.counts.pending ? ` · ${report.counts.pending} still running` : ""}
        {report.counts.failed ? ` · ${report.counts.failed} failed` : ""}
        {report.counts.missing_file ? ` · ${report.counts.missing_file} without a file` : ""}.
        {awaitingFiles.length > 0 && ` Rows without a file: ${awaitingFiles.slice(0, 6).join(", ")}${awaitingFiles.length > 6 ? "…" : ""}.`}
      </p>

      <dl className="grid grid-cols-2 gap-4 rounded-xl border border-border p-5 sm:grid-cols-3 lg:grid-cols-6">
        <Stat label="Review time saved" value={formatPercent(m.review_minutes_change === null ? null : -m.review_minutes_change)} hint={`${round(report.minutes.saved)} of ${round(report.minutes.before)} minutes`} />
        <Stat label={METRICS.automatic_rate.label} value={formatPercent(m.automatic_rate)} hint={`agreement ${formatPercent(m.agreement)} when deciding alone`} />
        <Stat label={METRICS.false_accept_rate.label} value={formatPercent(m.false_accept_rate)} hint={`${report.confusion.accept.reject} videos you rejected`} />
        <Stat label={METRICS.false_reject_rate.label} value={formatPercent(m.false_reject_rate)} hint={`${report.confusion.reject.accept} videos you accepted`} />
        <Stat label={METRICS.rejection_precision.label} value={formatPercent(m.rejection_precision)} hint={`base rate ${formatPercent(m.reviewer_reject_rate)} rejected`} />
        <Stat label={METRICS.rejection_recall.label} value={formatPercent(m.rejection_recall)} hint="rejected or sent to review" />
      </dl>

      <div className="grid gap-6 lg:grid-cols-2 [&>*]:min-w-0">
        <Card>
          <CardHeader>
            <CardTitle>Ormes vs your reviewers</CardTitle>
            <CardDescription>Each analysed video once: what Ormes decided against what your reviewers decided.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto rounded-lg border border-border">
              <Table>
                <TableHeader className="bg-subtle">
                  <TableRow>
                    <TableHead>Ormes</TableHead>
                    <TableHead className="whitespace-normal text-right">You accepted</TableHead>
                    <TableHead className="whitespace-normal text-right">You rejected</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <ConfusionRow label="Accepted" a={report.confusion.accept.accept} r={report.confusion.accept.reject} bad="r" />
                  <ConfusionRow label="Rejected" a={report.confusion.reject.accept} r={report.confusion.reject.reject} bad="a" />
                  <ConfusionRow label="Sent to review" a={report.confusion.review.accept} r={report.confusion.review.reject} />
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Review time</CardTitle>
            <CardDescription>
              With Ormes, people only review what it sends to review. Minutes are your reviewers&rsquo; own where the CSV gives them, otherwise {round(report.minutes.assumed_minutes)} per video.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-2 gap-4">
              <Stat label="Minutes today" value={round(report.minutes.before)} />
              <Stat label="Minutes with Ormes" value={round(report.minutes.after)} />
              <Stat label="Per video-hour today" value={report.minutes.per_hour_before === null ? "—" : round(report.minutes.per_hour_before)} />
              <Stat
                label="Per video-hour with Ormes"
                value={report.minutes.per_hour_after === null ? "—" : round(report.minutes.per_hour_after)}
                hint={`${round(report.minutes.footage_hours)} hours of footage`}
              />
            </dl>
          </CardContent>
        </Card>
      </div>

      {report.lab.videos > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Against the lab&rsquo;s outcome</CardTitle>
            <CardDescription>
              {report.lab.videos} videos with a lab outcome. &ldquo;With Ormes&rdquo; uses your reviewers&rsquo; decision for the videos Ormes sent to review.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <Stat label="False accepts, your reviewers" value={formatPercent(report.lab.reviewer_false_accept_rate)} />
              <Stat label="False accepts, with Ormes" value={formatPercent(report.lab.with_ormes_false_accept_rate)} />
              <Stat label="False rejects, your reviewers" value={formatPercent(report.lab.reviewer_false_reject_rate)} />
              <Stat label="False rejects, with Ormes" value={formatPercent(report.lab.with_ormes_false_reject_rate)} />
            </dl>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Per check</CardTitle>
          <CardDescription>How often each check flagged (failed or was unsure about) the videos your reviewers rejected, and the ones they accepted.</CardDescription>
        </CardHeader>
        <CardContent>
          {report.checks.length === 0 ? (
            <p className="text-[13.5px] text-muted-foreground">No check results yet.</p>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-border">
              <Table>
                <TableHeader className="bg-subtle">
                  <TableRow>
                    <TableHead>Check</TableHead>
                    <TableHead className="text-right">On rejected</TableHead>
                    <TableHead className="text-right">On accepted</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {report.checks.map((c) => (
                    <TableRow key={c.check}>
                      <TableCell className="whitespace-normal">{c.label}</TableCell>
                      <TableCell className="text-right font-mono tabular-nums">
                        {formatPercent(c.rejected ? c.flagged_on_rejected / c.rejected : null)}
                        <span className="block text-[11.5px] text-muted-foreground">
                          {c.flagged_on_rejected}/{c.rejected}
                        </span>
                      </TableCell>
                      <TableCell className="text-right font-mono tabular-nums">
                        {formatPercent(c.accepted ? c.flagged_on_accepted / c.accepted : null)}
                        <span className="block text-[11.5px] text-muted-foreground">
                          {c.flagged_on_accepted}/{c.accepted}
                        </span>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Duplicates</CardTitle>
          <CardDescription>Videos that repeat an earlier video of your organization, by contributor.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">
          {report.duplicates.items.length === 0 ? (
            <p className="text-[13.5px] text-muted-foreground">No duplicates found.</p>
          ) : (
            <>
              <p className="text-[14px]">
                <strong className="font-medium">{report.duplicates.across_contributors}</strong> from a different contributor,{" "}
                <strong className="font-medium">{report.duplicates.same_contributor}</strong> from the same contributor, {report.duplicates.unknown} with no contributor id.
              </p>
              <ul className="grid gap-1 text-[13.5px]">
                {report.duplicates.items.slice(0, 20).map((d) => (
                  <li key={d.video_id}>
                    <Link href={`/app/videos/${d.video_id}`} className="font-mono hover:underline">
                      {d.external_id}
                    </Link>{" "}
                    <span className="text-muted-foreground">
                      ({d.contributor_ref ?? "unknown"}) repeats a video by {d.matched_contributor_ref ?? "an unknown contributor"}
                      {d.similarity !== null ? `, similarity ${d.similarity.toFixed(2)}` : ""}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </CardContent>
      </Card>

      <Disagreements report={report} />
    </>
  );
}

function Disagreements({ report }: { report: PilotReport }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Disagreements to inspect ({report.disagreements.length})</CardTitle>
        <CardDescription>Videos Ormes decided on its own, differently from your reviewers. False accepts first; the timestamps point at what Ormes saw.</CardDescription>
      </CardHeader>
      <CardContent>
        {report.disagreements.length === 0 ? (
          <p className="text-[13.5px] text-muted-foreground">None: every automatic decision matched your reviewers.</p>
        ) : (
          <ul className="grid gap-2" aria-label="Disagreements">
            {report.disagreements.map((d) => (
              <li key={d.video_id} className="grid gap-1.5 rounded-lg border border-border p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Link href={`/app/videos/${d.video_id}`} className="font-mono text-[13.5px] font-medium hover:underline">
                    {d.external_id}
                  </Link>
                  <Badge tone={d.kind === "false_accept" ? "reject" : "review"}>{d.kind === "false_accept" ? "false accept" : "false reject"}</Badge>
                  <span className="text-[13px] text-muted-foreground">
                    you {d.reviewer === "accept" ? "accepted" : "rejected"}, Ormes {d.ormes === "accept" ? "accepted" : "rejected"}
                  </span>
                </div>
                {d.moments.length > 0 ? (
                  <ul className="grid gap-0.5 text-[13px]">
                    {d.moments.map((mo, i) => (
                      <li key={i}>
                        <span className="font-mono">{mo.t ?? "whole video"}</span> {mo.label}
                        <span className="text-muted-foreground"> · {mo.detail}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-[13px] text-muted-foreground">{d.reasons.length ? d.reasons.join(", ") : "Ormes found nothing wrong with this video."}</p>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function round(n: number) {
  return n >= 100 ? Math.round(n).toString() : (Math.round(n * 10) / 10).toString();
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

function ConfusionRow({ label, a, r, bad }: { label: string; a: number; r: number; bad?: "a" | "r" }) {
  return (
    <TableRow>
      <TableCell>{label}</TableCell>
      <TableCell className={cn("text-right font-mono tabular-nums", bad === "a" && a > 0 && "text-reject-fg")}>{a}</TableCell>
      <TableCell className={cn("text-right font-mono tabular-nums", bad === "r" && r > 0 && "text-reject-fg")}>{r}</TableCell>
    </TableRow>
  );
}
