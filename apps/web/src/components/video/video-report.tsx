"use client";

import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Collapsible } from "radix-ui";
import { ChevronRight, CircleCheck, CircleDot, CircleMinus, CircleX, Clock, TriangleAlert, UserRound } from "lucide-react";
import { DecisionBadge } from "@/components/app/decision-badge";
import { Badge } from "@/components/ui/badge";
import { checkLabel, formatAge, formatClock, formatDateTime } from "@/lib/format";
import { formatMeasurement, measurementLabel } from "@/lib/measurements";
import { reasonMarkers, videoDuration, type StoredCheck, type TimelineReason } from "@/lib/timeline";
import type { ReviewItem } from "@/lib/domain/videos";
import { cn } from "@/lib/utils";
import { VideoPlayer, type PlayerHandle } from "./video-player";

const CHECK_ORDER = ["task_completed", "hands_visible", "framing", "technical", "privacy", "originality"];

const STATUS = {
  pass: { icon: CircleCheck, tone: "accept", label: "pass" },
  fail: { icon: CircleX, tone: "reject", label: "fail" },
  uncertain: { icon: CircleDot, tone: "review", label: "uncertain" },
  error: { icon: TriangleAlert, tone: "review", label: "error" },
  skipped: { icon: CircleMinus, tone: "neutral", label: "skipped" },
} as const;

export function videoTitle(item: Pick<ReviewItem, "video" | "filename">): string {
  return item.video.external_id ?? item.filename ?? item.video.id.slice(0, 8);
}

/** The video report: player with pinned reasons, every check with its measurements, and actions. */
export function VideoReport({
  item,
  rubricName,
  actions,
  headingLevel = 2,
}: {
  item: ReviewItem;
  rubricName?: string;
  actions?: React.ReactNode;
  headingLevel?: 1 | 2;
}) {
  const decision = item.video.decision;
  const reasons = useMemo(() => (decision?.reasons ?? []) as TimelineReason[], [decision]);
  const checks = useMemo(() => (decision?.checks ?? {}) as Record<string, StoredCheck & { model?: string }>, [decision]);
  const duration = videoDuration(item.durationS, checks);
  const markers = useMemo(() => reasonMarkers(reasons, checks, duration), [reasons, checks, duration]);
  const player = useRef<PlayerHandle>(null);
  const [activeReason, setActiveReason] = useState<number | null>(null);
  const Heading = headingLevel === 1 ? "h1" : "h2";
  const ordered = CHECK_ORDER.filter((c) => checks[c]).map((c) => [c, checks[c]] as const);
  const rubricVersion = decision?.rubric.version ?? item.video.rubric_version;

  return (
    <div className="grid gap-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2.5">
            <Heading className="truncate font-mono text-[19px] font-medium tracking-[-0.01em]">{videoTitle(item)}</Heading>
            <DecisionBadge value={decision?.decision} />
            {item.video.review && (
              <Badge tone="outline">
                <UserRound aria-hidden />
                reviewed: {item.video.review.decision}
              </Badge>
            )}
          </div>
          <p className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-[13px] text-muted-foreground">
            {item.contributorRef && <span>Contributor {item.contributorRef}</span>}
            <span title={formatDateTime(item.video.created_at)}>
              <Clock className="mr-1 inline size-3.5 -translate-y-px" aria-hidden />
              Received {formatAge(item.video.created_at)} ago
            </span>
            <Link href={`/app/rubrics/${item.video.rubric_id}`} className="rounded underline-offset-2 hover:text-foreground hover:underline">
              {rubricName ?? "Rubric"} v{rubricVersion}
            </Link>
          </p>
        </div>
      </div>

      <VideoPlayer
        key={item.video.id}
        ref={player}
        src={item.playbackUrl}
        duration={duration}
        markers={markers}
        activeReason={activeReason}
        onMarker={setActiveReason}
      />

      {actions}

      <section aria-labelledby={`why-${item.video.id}`} className="grid gap-2.5">
        <h3 id={`why-${item.video.id}`} className="font-mono text-[11.5px] uppercase tracking-[0.08em] text-muted-foreground">
          Reasons
        </h3>
        {!decision ? (
          <p className="text-[14px] text-muted-foreground">No decision yet. The analysis usually takes under a minute.</p>
        ) : reasons.length === 0 ? (
          <p className="text-[14px] text-muted-foreground">Every enabled check passed.</p>
        ) : (
          <ul className="grid gap-1.5">
            {reasons.map((r, i) => {
              const marker = markers.find((m) => m.reasonIndex === i);
              const body = (
                <>
                  <span className={cn("mt-1.5 size-2 shrink-0 rounded-full", r.effect === "reject" ? "bg-no" : "bg-brand")} aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className="block text-[14px] leading-snug">{r.message}</span>
                    <span className="mt-0.5 block font-mono text-[11.5px] text-muted-foreground">
                      {r.effect === "reject" ? "rejects" : "sends to review"} · {r.code}
                    </span>
                  </span>
                  {marker && (
                    <span className="shrink-0 rounded-md bg-muted px-1.5 font-mono text-[11.5px] leading-5 tabular-nums">{formatClock(marker.t)}</span>
                  )}
                </>
              );
              const cls = cn(
                "flex w-full items-start gap-3 rounded-lg border border-border px-3 py-2.5 text-left transition-colors",
                activeReason === i && "border-foreground/30 bg-subtle",
              );
              return (
                <li key={`${r.code}-${i}`}>
                  {marker ? (
                    <button
                      type="button"
                      className={cn(cls, "hover:bg-subtle")}
                      onClick={() => {
                        player.current?.seek(marker.t);
                        setActiveReason(i);
                      }}
                      aria-label={`${r.message} Jump to ${formatClock(marker.t)}`}
                    >
                      {body}
                    </button>
                  ) : (
                    <div className={cls}>{body}</div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        {item.video.review?.note && (
          <p className="rounded-lg bg-subtle px-3 py-2.5 text-[13.5px]">
            <span className="text-muted-foreground">Reviewer note: </span>
            {item.video.review.note}
          </p>
        )}
      </section>

      {ordered.length > 0 && (
        <section aria-labelledby={`checks-${item.video.id}`} className="grid gap-2.5">
          <h3 id={`checks-${item.video.id}`} className="font-mono text-[11.5px] uppercase tracking-[0.08em] text-muted-foreground">
            Checks and measurements
          </h3>
          <div className="divide-y divide-border rounded-xl border border-border">
            {ordered.map(([name, c]) => (
              <CheckRow key={name} name={name} check={c} />
            ))}
          </div>
          {decision && <p className="font-mono text-[11.5px] text-muted-foreground">Engine {decision.engine_version}</p>}
        </section>
      )}
    </div>
  );
}

function CheckRow({ name, check }: { name: string; check: StoredCheck & { model?: string } }) {
  const status = STATUS[(check.status ?? "skipped") as keyof typeof STATUS] ?? STATUS.skipped;
  const entries = Object.entries(check.measurements ?? {});
  const [open, setOpen] = useState(check.status === "fail" || check.status === "uncertain" || check.status === "error");
  const Icon = status.icon;
  return (
    <Collapsible.Root open={open} onOpenChange={setOpen}>
      <Collapsible.Trigger className="flex w-full items-center gap-3 px-3.5 py-3 text-left outline-none transition-colors hover:bg-subtle focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
        <ChevronRight className={cn("size-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-90")} aria-hidden />
        <span className="flex-1 text-[14px] font-medium">{checkLabel(name)}</span>
        {check.model && <span className="hidden font-mono text-[11.5px] text-muted-foreground sm:inline">{check.model}</span>}
        <Badge tone={status.tone}>
          <Icon aria-hidden />
          {status.label}
        </Badge>
      </Collapsible.Trigger>
      <Collapsible.Content className="overflow-hidden data-[state=closed]:animate-collapsible-up data-[state=open]:animate-collapsible-down">
        {entries.length ? (
          <dl className="grid grid-cols-1 gap-x-6 gap-y-1.5 px-3.5 pb-3.5 pl-10 sm:grid-cols-2">
            {entries.map(([k, v]) => (
              <div key={k} className="flex items-baseline justify-between gap-3 border-b border-dashed border-border py-1 text-[13px]">
                <dt className="text-muted-foreground">{measurementLabel(k)}</dt>
                <dd className="text-right font-mono text-[12.5px] tabular-nums">{formatMeasurement(k, v)}</dd>
              </div>
            ))}
          </dl>
        ) : (
          <p className="px-3.5 pb-3.5 pl-10 text-[13px] text-muted-foreground">
            {check.status === "skipped" ? "Disabled in this rubric, or not needed." : "No measurements were recorded."}
          </p>
        )}
      </Collapsible.Content>
    </Collapsible.Root>
  );
}
