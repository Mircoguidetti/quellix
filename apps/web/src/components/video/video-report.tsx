"use client";

import { useCallback, useImperativeHandle, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Collapsible } from "radix-ui";
import { ChevronRight, CircleCheck, CircleDot, CircleMinus, CircleX, Clock, TriangleAlert, UserRound } from "lucide-react";
import { DecisionBadge } from "@/components/app/decision-badge";
import { Badge } from "@/components/ui/badge";
import { Kbd } from "@/components/ui/kbd";
import { checkLabel, formatAge, formatDateTime } from "@/lib/format";
import { formatMeasurement, measurementLabel } from "@/lib/measurements";
import { flaggedMoments, momentClock, videoDuration, type StoredCheck, type TimelineReason } from "@/lib/timeline";
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

export type ReportHandle = { next: () => void; prev: () => void; replay: () => void };

/** Seconds of context shown before a flagged moment when the player jumps there. */
const LEAD_IN = 1.5;

/**
 * The video report: player, the flagged moments (each with its reason and measurement), every
 * check, and optional actions. The reviewer steps through moments instead of watching it all.
 */
export function VideoReport({
  item,
  rubricName,
  actions,
  headingLevel = 2,
  ref,
}: {
  item: ReviewItem;
  rubricName?: string;
  actions?: React.ReactNode;
  headingLevel?: 1 | 2;
  ref?: React.Ref<ReportHandle>;
}) {
  const decision = item.video.decision;
  const reasons = useMemo(() => (decision?.reasons ?? []) as TimelineReason[], [decision]);
  const checks = useMemo(() => (decision?.checks ?? {}) as Record<string, StoredCheck & { model?: string }>, [decision]);
  const duration = videoDuration(item.durationS, checks);
  const moments = useMemo(() => flaggedMoments(reasons, checks, duration), [reasons, checks, duration]);
  const markers = useMemo(
    () => moments.flatMap((m) => (m.t === null ? [] : [{ key: m.key, t: m.t, end: m.end, label: m.label, effect: m.effect }])),
    [moments],
  );
  const player = useRef<PlayerHandle>(null);
  const [active, setActive] = useState<string | null>(moments[0]?.key ?? null);
  const Heading = headingLevel === 1 ? "h1" : "h2";
  const ordered = CHECK_ORDER.filter((c) => checks[c]).map((c) => [c, checks[c]] as const);
  const rubricVersion = decision?.rubric.version ?? item.video.rubric_version;
  const firstTimed = moments.find((m) => m.t !== null);

  const go = useCallback(
    (index: number, play = true) => {
      const m = moments[Math.min(Math.max(index, 0), moments.length - 1)];
      if (!m) return;
      setActive(m.key);
      if (m.t !== null) player.current?.seek(Math.max(0, m.t - LEAD_IN), play);
      document.getElementById(`moment-${item.video.id}-${m.key}`)?.scrollIntoView({ block: "nearest" });
    },
    [moments, item.video.id],
  );
  const activeIndex = Math.max(0, moments.findIndex((m) => m.key === active));
  useImperativeHandle(ref, () => ({ next: () => go(activeIndex + 1), prev: () => go(activeIndex - 1), replay: () => go(activeIndex) }), [go, activeIndex]);

  return (
    <div className="grid gap-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2.5">
            <Heading className="truncate font-mono text-[19px] font-medium tracking-[-0.01em]">{videoTitle(item)}</Heading>
            <DecisionBadge value={decision?.decision} status={item.video.status} error={item.failureReason} />
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
        startAt={firstTimed?.t === null || !firstTimed ? 0 : Math.max(0, firstTimed.t - LEAD_IN)}
        markers={markers}
        activeKey={active}
        onMarker={(key) => go(moments.findIndex((m) => m.key === key))}
      />

      <section aria-labelledby={`moments-${item.video.id}`} className="grid gap-2.5">
        <div className="flex items-baseline justify-between gap-3">
          <h3 id={`moments-${item.video.id}`} className="font-mono text-[11.5px] uppercase tracking-[0.08em] text-muted-foreground">
            Flagged moments{moments.length ? ` · ${moments.length}` : ""}
          </h3>
          {moments.length > 1 && (
            <p className="hidden items-center gap-1 text-[12px] text-muted-foreground pointer-fine:flex">
              <Kbd>J</Kbd>
              <Kbd>K</Kbd> step through · <Kbd>Enter</Kbd> replay
            </p>
          )}
        </div>
        {!decision ? (
          <p className="text-[14px] text-muted-foreground">
            {item.video.status === "failed"
              ? `The analysis failed${item.failureReason ? `: ${item.failureReason}` : "."} Upload the video again to retry.`
              : "No decision yet. The analysis usually takes under a minute."}
          </p>
        ) : moments.length === 0 ? (
          <p className="text-[14px] text-muted-foreground">Nothing was flagged: every enabled check passed.</p>
        ) : (
          <ol className="grid max-h-[22rem] gap-1.5 overflow-y-auto">
            {moments.map((m, i) => (
              <li key={m.key}>
                <button
                  type="button"
                  id={`moment-${item.video.id}-${m.key}`}
                  onClick={() => go(i)}
                  aria-current={active === m.key ? "true" : undefined}
                  className={cn(
                    "flex w-full items-start gap-3 rounded-lg border border-border px-3 py-2.5 text-left outline-none transition-colors hover:bg-subtle focus-visible:ring-2 focus-visible:ring-ring",
                    active === m.key && "border-foreground/40 bg-subtle",
                  )}
                >
                  <span className="w-[4.25rem] shrink-0 rounded-md bg-muted px-1.5 text-center font-mono text-[11.5px] leading-5 tabular-nums">
                    {m.t === null ? "whole" : momentClock(m.t)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2 text-[14px] font-medium leading-snug">
                      <span className={cn("size-2 shrink-0 rounded-full", m.effect === "reject" ? "bg-no" : "bg-brand")} aria-hidden />
                      {m.label}
                      <span className="font-mono text-[11px] font-normal text-muted-foreground">{m.effect === "reject" ? "rejects" : "to review"}</span>
                    </span>
                    <span className="mt-0.5 block text-[13.5px] leading-snug text-muted-foreground">{m.message}</span>
                    <span className="mt-1 block font-mono text-[12px] text-foreground/80">{m.detail}</span>
                  </span>
                </button>
              </li>
            ))}
          </ol>
        )}
        {item.video.review?.note && (
          <p className="rounded-lg bg-subtle px-3 py-2.5 text-[13.5px]">
            <span className="text-muted-foreground">Reviewer note: </span>
            {item.video.review.note}
          </p>
        )}
      </section>

      {actions}

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
