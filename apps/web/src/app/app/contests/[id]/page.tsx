import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ArrowUpRight, Quote } from "lucide-react";
import { DecisionBadge } from "@/components/app/decision-badge";
import { PageContainer, PageHeader } from "@/components/app/page-header";
import { Badge, toneFor } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { dashboardContext } from "@/lib/dashboard";
import { contributorReasons, getContest } from "@/lib/domain/contests";
import { getVideo } from "@/lib/domain/videos";
import { formatDateTime } from "@/lib/format";
import { ResolveDialog } from "./resolve-dialog";

export const metadata: Metadata = { title: "Contest" };

const LABEL = { open: "open", upheld: "rejection upheld", overturned: "overturned" } as const;

export default function ContestPage({ params }: PageProps<"/app/contests/[id]">) {
  return (
    <PageContainer className="max-w-[960px]">
      <Suspense fallback={<Skeleton className="h-96 rounded-xl" />}>
        <Content params={params} />
      </Suspense>
    </PageContainer>
  );
}

async function Content({ params }: { params: PageProps<"/app/contests/[id]">["params"] }) {
  const { id } = await params;
  const { db, orgId } = await dashboardContext();
  const contest = await getContest(db, orgId, id);
  if (!contest) notFound();
  const video = await getVideo(db, orgId, contest.video_id).catch(() => null);
  const shown = contributorReasons(video?.decision?.reasons);

  return (
    <>
      <PageHeader
        eyebrow={
          <Link href="/app/contests" className="inline-flex items-center gap-1.5 rounded hover:text-foreground">
            <ArrowLeft className="size-3.5" aria-hidden />
            Contests
          </Link>
        }
        title={
          <span className="flex flex-wrap items-center gap-2.5">
            Contest from <span className="font-mono">{contest.contributor_ref ?? "a contributor"}</span>
            <Badge tone={toneFor(contest.status)}>{LABEL[contest.status]}</Badge>
          </span>
        }
        description={`Received ${formatDateTime(contest.created_at)}`}
        actions={contest.status === "open" ? <ResolveDialog contestId={contest.id} /> : undefined}
      />

      <Card className="grid gap-3 p-5">
        <h2 className="flex items-center gap-2 font-mono text-[11.5px] uppercase tracking-[0.08em] text-muted-foreground">
          <Quote className="size-3.5" aria-hidden />
          Their message
        </h2>
        <p className="whitespace-pre-wrap text-[15px] leading-relaxed">{contest.message}</p>
      </Card>

      <Card className="grid gap-4 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <h2 className="font-mono text-[15px] font-medium">{video?.external_id ?? contest.video_id.slice(0, 8)}</h2>
            <DecisionBadge value={video?.review?.decision ?? video?.decision?.decision} />
          </div>
          <Button asChild variant="secondary" size="sm">
            <Link href={`/app/videos/${contest.video_id}`}>
              Open the video report
              <ArrowUpRight aria-hidden />
            </Link>
          </Button>
        </div>
        <div className="grid gap-1.5">
          <h3 className="text-[13px] font-medium">What the contributor was told</h3>
          {shown.length ? (
            <ul className="grid gap-1 pl-5 text-[14px]">
              {shown.map((r) => (
                <li key={r} className="list-disc">
                  {r}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[14px] text-muted-foreground">No detailed reason was shown.</p>
          )}
        </div>
      </Card>

      {contest.status !== "open" && (
        <Card className="grid gap-2 p-5">
          <h2 className="text-[14px] font-medium">Resolution</h2>
          <p className="text-[14px]">
            {contest.status === "overturned" ? "The rejection was overturned." : "The rejection was upheld."}{" "}
            <span className="text-muted-foreground">{formatDateTime(contest.resolved_at)}</span>
          </p>
          {contest.resolution_note && <p className="rounded-lg bg-subtle px-3 py-2.5 text-[14px]">{contest.resolution_note}</p>}
        </Card>
      )}
    </>
  );
}
