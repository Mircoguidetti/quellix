"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { ArrowLeft, Check, ChevronDown, ChevronUp, Inbox, Keyboard, PartyPopper, X } from "lucide-react";
import { useReviewCount } from "@/components/shell/review-count";
import { EmptyState } from "@/components/app/empty-state";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Textarea } from "@/components/ui/input";
import { VideoReport, videoTitle } from "@/components/video/video-report";
import type { ReviewItem } from "@/lib/domain/videos";
import { formatAge } from "@/lib/format";
import { cn } from "@/lib/utils";
import { submitReview, undoReviewAction } from "./actions";

const SHORTCUTS: [string, string][] = [
  ["J", "Next video"],
  ["K", "Previous video"],
  ["A", "Accept"],
  ["R", "Reject"],
  ["N", "Write a note"],
  ["Esc", "Leave the note field"],
];

function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  return el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName) || el.getAttribute("role") === "combobox";
}

export function ReviewWorkspace({ initialItems, rubricNames }: { initialItems: ReviewItem[]; rubricNames: Record<string, string> }) {
  const [items, setItems] = useState(initialItems);
  const [selectedId, setSelectedId] = useState<string | null>(initialItems[0]?.video.id ?? null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [mobileDetail, setMobileDetail] = useState(false);
  const [busy, setBusy] = useState(false);
  const noteRef = useRef<HTMLTextAreaElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const { adjust } = useReviewCount();

  const index = Math.max(0, items.findIndex((i) => i.video.id === selectedId));
  const current = items.length ? items[index] : null;

  const select = useCallback(
    (i: number) => {
      const next = items[Math.min(Math.max(i, 0), items.length - 1)];
      if (!next) return;
      setSelectedId(next.video.id);
      listRef.current?.querySelector<HTMLElement>(`[data-id="${next.video.id}"]`)?.scrollIntoView({ block: "nearest" });
    },
    [items],
  );

  const decide = useCallback(
    async (decision: "accept" | "reject") => {
      if (!current || busy) return;
      const item = current;
      const position = index;
      const note = notes[item.video.id]?.trim() || undefined;
      const remaining = items.filter((i) => i.video.id !== item.video.id);
      // Optimistic: the video leaves the queue now; we put it back if saving fails.
      setItems(remaining);
      setSelectedId(remaining[Math.min(position, remaining.length - 1)]?.video.id ?? null);
      adjust(-1);
      setBusy(true);
      const res = await submitReview(item.video.id, { decision, note }).catch(() => ({ ok: false as const, error: "We could not reach Quellix. Check your connection." }));
      setBusy(false);
      const restore = () => {
        setItems((list) => {
          if (list.some((i) => i.video.id === item.video.id)) return list;
          const copy = [...list];
          copy.splice(Math.min(position, copy.length), 0, item);
          return copy;
        });
        setSelectedId(item.video.id);
        adjust(1);
      };
      if (!res.ok) {
        restore();
        toast.error(res.error);
        return;
      }
      const verb = decision === "accept" ? "Accepted" : "Rejected";
      toast.success(`${verb} ${videoTitle(item)}`, {
        description: note ? `Note: ${note}` : undefined,
        duration: 7000,
        action: {
          label: "Undo",
          onClick: async () => {
            const undone = await undoReviewAction(res.reviewId).catch(() => ({ ok: false, error: "We could not undo the review." }));
            if (undone.ok) {
              restore();
              toast(`${videoTitle(item)} is back in the queue`);
            } else toast.error(undone.error ?? "We could not undo the review.");
          },
        },
      });
    },
    [current, busy, index, notes, items, adjust],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (isTyping(e.target)) {
        if (e.key === "Escape") (e.target as HTMLElement).blur();
        return;
      }
      if (document.querySelector('[role="dialog"], [role="alertdialog"], [role="menu"]')) return;
      const key = e.key.toLowerCase();
      if (key === "j") select(index + 1);
      else if (key === "k") select(index - 1);
      else if (key === "a") void decide("accept");
      else if (key === "r") void decide("reject");
      else if (key === "n") noteRef.current?.focus();
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [select, decide, index]);

  if (!current) {
    return (
      <div className="mx-auto flex w-full max-w-[1240px] flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
        <h1 className="text-2xl font-medium tracking-[-0.02em]">Review</h1>
        <EmptyState
          icon={initialItems.length ? PartyPopper : Inbox}
          title={initialItems.length ? "All caught up" : "Nothing to review"}
          description="Doubtful videos land here with the reason Quellix could not decide. Clear cases are accepted or rejected for you."
          action={
            <div className="flex flex-wrap justify-center gap-2">
              <Button asChild variant="secondary">
                <Link href="/app">Back to overview</Link>
              </Button>
              <Button asChild>
                <Link href="/app/videos">See all videos</Link>
              </Button>
            </div>
          }
        />
      </div>
    );
  }

  return (
    <div className="grid min-h-[calc(100dvh-3.5rem)] lg:h-dvh lg:min-h-0 lg:grid-cols-[340px_minmax(0,1fr)]">
      {/* Queue */}
      <section aria-label="Review queue" className={cn("flex min-h-0 flex-col border-border lg:border-r", mobileDetail && "hidden lg:flex")}>
        <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3.5">
          <div>
            <h1 className="text-[17px] font-medium tracking-[-0.01em]">Review</h1>
            <p className="text-[12.5px] text-muted-foreground">
              <span className="tabular-nums">{items.length}</span> waiting · newest first
            </p>
          </div>
          <ShortcutsHelp />
        </div>
        <ul ref={listRef} className="min-h-0 flex-1 overflow-y-auto p-2" aria-label="Videos waiting for review">
          {items.map((item, i) => {
            const firstReason = ((item.video.decision?.reasons ?? []) as { message: string }[])[0]?.message;
            const active = i === index;
            return (
              <li key={item.video.id}>
                <button
                  type="button"
                  data-id={item.video.id}
                  onClick={() => {
                    setSelectedId(item.video.id);
                    setMobileDetail(true);
                  }}
                  aria-current={active ? "true" : undefined}
                  className={cn(
                    "relative grid w-full gap-1 rounded-lg px-3 py-2.5 text-left outline-none transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                    active && "bg-muted before:absolute before:inset-y-2 before:left-0 before:w-0.5 before:rounded-full before:bg-foreground",
                  )}
                >
                  <span className="flex items-center justify-between gap-2">
                    <span className="truncate font-mono text-[13px] font-medium">{videoTitle(item)}</span>
                    <span className="shrink-0 font-mono text-[11.5px] text-muted-foreground">{formatAge(item.video.created_at)}</span>
                  </span>
                  {firstReason && <span className="line-clamp-2 text-[13px] leading-snug text-muted-foreground">{firstReason}</span>}
                  {item.contributorRef && <span className="font-mono text-[11.5px] text-muted-foreground">{item.contributorRef}</span>}
                </button>
              </li>
            );
          })}
        </ul>
      </section>

      {/* Report */}
      <section aria-label="Selected video" className={cn("min-h-0 overflow-y-auto", !mobileDetail && "hidden lg:block")}>
        <div className="mx-auto grid w-full max-w-[920px] gap-4 px-4 py-5 sm:px-6 lg:px-8 lg:py-7">
          <div className="flex items-center justify-between gap-2">
            <Button variant="ghost" size="sm" className="-ml-2 lg:hidden" onClick={() => setMobileDetail(false)}>
              <ArrowLeft aria-hidden />
              Queue
            </Button>
            <span className="hidden font-mono text-[12px] text-muted-foreground lg:inline">
              {index + 1} of {items.length}
            </span>
            <div className="flex gap-1">
              <Button variant="ghost" size="icon-sm" onClick={() => select(index - 1)} disabled={index === 0} aria-label="Previous video (K)">
                <ChevronUp aria-hidden />
              </Button>
              <Button variant="ghost" size="icon-sm" onClick={() => select(index + 1)} disabled={index === items.length - 1} aria-label="Next video (J)">
                <ChevronDown aria-hidden />
              </Button>
            </div>
          </div>
          <VideoReport
            key={current.video.id}
            item={current}
            rubricName={rubricNames[current.video.rubric_id]}
            headingLevel={2}
            actions={
              <div className="grid gap-3 rounded-xl border border-border bg-subtle p-3.5 sm:grid-cols-[1fr_auto] sm:items-end">
                <div className="grid gap-1.5">
                  <Label htmlFor="review-note" className="text-[13px]">
                    Note <span className="font-normal text-muted-foreground">(optional, kept with the review)</span>
                  </Label>
                  <Textarea
                    id="review-note"
                    ref={noteRef}
                    rows={1}
                    maxLength={2000}
                    placeholder="What did you see?"
                    className="min-h-9 bg-background"
                    value={notes[current.video.id] ?? ""}
                    onChange={(e) => setNotes((n) => ({ ...n, [current.video.id]: e.target.value }))}
                  />
                </div>
                <div className="flex gap-2">
                  <Button variant="reject" onClick={() => decide("reject")} disabled={busy} className="flex-1 sm:flex-none">
                    <X aria-hidden />
                    Reject
                    <Kbd className="ml-1 hidden border-white/25 bg-white/15 text-white pointer-fine:inline-flex">R</Kbd>
                  </Button>
                  <Button variant="accept" onClick={() => decide("accept")} disabled={busy} className="flex-1 sm:flex-none">
                    <Check aria-hidden />
                    Accept
                    <Kbd className="ml-1 hidden border-white/25 bg-white/15 text-white pointer-fine:inline-flex">A</Kbd>
                  </Button>
                </div>
              </div>
            }
          />
        </div>
      </section>
    </div>
  );
}

function ShortcutsHelp() {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label="Keyboard shortcuts">
          <Keyboard aria-hidden />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-60 p-3">
        <p className="mb-2 text-[13px] font-medium">Keyboard shortcuts</p>
        <dl className="grid gap-1.5">
          {SHORTCUTS.map(([key, label]) => (
            <div key={key} className="flex items-center justify-between text-[13px]">
              <dt className="text-muted-foreground">{label}</dt>
              <dd>
                <Kbd>{key}</Kbd>
              </dd>
            </div>
          ))}
        </dl>
      </PopoverContent>
    </Popover>
  );
}
