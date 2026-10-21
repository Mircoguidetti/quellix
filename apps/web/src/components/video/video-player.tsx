"use client";

import { useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import { FileX2, Pause, Play } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { formatClock } from "@/lib/format";
import { cn } from "@/lib/utils";

export type PlayerHandle = { seek: (t: number, play?: boolean) => void };
export type PlayerMarker = { key: string; t: number; end?: number; label: string; effect: "reject" | "review" };

type Props = {
  src: string | null;
  duration: number | null;
  /** Where the playhead starts, e.g. just before the first flagged moment. */
  startAt?: number;
  markers: PlayerMarker[];
  activeKey: string | null;
  onMarker: (key: string) => void;
  ref?: React.Ref<PlayerHandle>;
};

/**
 * Video with the decision's reasons pinned to the timeline. Works without a file too: Quellix
 * deletes videos after analysis, so the timeline still shows where each reason happened.
 * Give it a `key` per video so its playback state starts fresh.
 */
export function VideoPlayer({ src, duration: knownDuration, startAt = 0, markers, activeKey, onMarker, ref }: Props) {
  const video = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(startAt);
  const [mediaDuration, setMediaDuration] = useState<number | null>(null);
  const [failed, setFailed] = useState(false);
  const duration = mediaDuration ?? knownDuration ?? 0;
  const playable = Boolean(src) && !failed;

  const seek = useCallback(
    (t: number, play = false) => {
      const clamped = Math.max(0, Math.min(duration || t, t));
      setTime(clamped);
      if (video.current && playable) {
        video.current.currentTime = clamped;
        if (play) void video.current.play().catch(() => undefined);
      }
    },
    [duration, playable],
  );
  useImperativeHandle(ref, () => ({ seek }), [seek]);

  // The metadata can load before hydration, when onLoadedMetadata is not attached yet.
  useEffect(() => {
    const el = video.current;
    if (el && el.readyState >= 1 && el.currentTime === 0 && startAt > 0) el.currentTime = startAt;
  }, [startAt]);

  const toggle = () => {
    const el = video.current;
    if (!el || !playable) return;
    if (el.paused) void el.play().catch(() => setFailed(true));
    else el.pause();
  };

  const pct = (t: number) => (duration ? `${(Math.min(t, duration) / duration) * 100}%` : "0%");

  return (
    <div className="dark overflow-hidden rounded-xl border border-border bg-panel text-foreground">
      <div className="relative aspect-video w-full bg-black">
        {playable ? (
          <video
            ref={video}
            src={src ?? undefined}
            className="absolute inset-0 size-full object-contain"
            preload="metadata"
            playsInline
            muted
            onClick={toggle}
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
            onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)}
            onLoadedMetadata={(e) => {
              const el = e.currentTarget;
              if (Number.isFinite(el.duration)) setMediaDuration(el.duration);
              // Keep a jump made before the metadata arrived; otherwise start at startAt.
              if (el.currentTime === 0 && time > 0) el.currentTime = time;
            }}
            onError={() => setFailed(true)}
            aria-label="Video"
          />
        ) : (
          <div className="absolute inset-0 grid place-items-center bg-[repeating-linear-gradient(135deg,#0f1114_0_12px,#0c0e10_12px_24px)] p-6 text-center">
            <div className="grid max-w-xs justify-items-center gap-2">
              <FileX2 className="size-6 text-muted-foreground" aria-hidden />
              <p className="text-[14px] font-medium">{failed ? "This video cannot be played" : "The file was deleted after analysis"}</p>
              <p className="text-[13px] text-muted-foreground">Reasons, measurements and their moments in the video are kept below.</p>
            </div>
          </div>
        )}
        {playable && (
          <div className="pointer-events-none absolute left-3 top-3 rounded-md bg-black/60 px-2 py-1 font-mono text-[11.5px] text-foreground/90 backdrop-blur">
            {formatClock(time)} / {formatClock(duration)}
          </div>
        )}
      </div>

      <div className="flex items-center gap-3 px-3 py-2.5">
        <button
          type="button"
          onClick={toggle}
          disabled={!playable}
          className="grid size-8 shrink-0 place-items-center rounded-full bg-foreground text-background transition-opacity disabled:opacity-30"
          aria-label={playing ? "Pause" : "Play"}
        >
          {playing ? <Pause className="size-3.5" aria-hidden /> : <Play className="ml-0.5 size-3.5" aria-hidden />}
        </button>
        <Timeline duration={duration} time={time} markers={markers} activeKey={activeKey} onSeek={seek} onMarker={onMarker} pct={pct} />
        <span className="shrink-0 font-mono text-[11.5px] text-muted-foreground tabular-nums">{formatClock(duration)}</span>
      </div>
    </div>
  );
}

function Timeline({
  duration,
  time,
  markers,
  activeKey,
  onSeek,
  onMarker,
  pct,
}: {
  duration: number;
  time: number;
  markers: PlayerMarker[];
  activeKey: string | null;
  onSeek: (t: number) => void;
  onMarker: (key: string) => void;
  pct: (t: number) => string;
}) {
  const track = useRef<HTMLDivElement>(null);
  const fromPointer = (clientX: number) => {
    const rect = track.current?.getBoundingClientRect();
    if (!rect || !duration) return;
    onSeek(((clientX - rect.left) / rect.width) * duration);
  };

  return (
    <div className="relative h-8 flex-1">
      <div
        ref={track}
        role="slider"
        tabIndex={0}
        aria-label="Seek"
        aria-valuemin={0}
        aria-valuemax={Math.round(duration)}
        aria-valuenow={Math.round(time)}
        aria-valuetext={`${formatClock(time)} of ${formatClock(duration)}`}
        className="absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 cursor-pointer rounded-full bg-[#2a2e34] outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onPointerDown={(e) => fromPointer(e.clientX)}
        onKeyDown={(e) => {
          if (e.key === "ArrowRight") onSeek(time + 5);
          else if (e.key === "ArrowLeft") onSeek(time - 5);
          else if (e.key === "Home") onSeek(0);
          else if (e.key === "End") onSeek(duration);
          else return;
          e.preventDefault();
          e.stopPropagation();
        }}
      >
        {markers
          .filter((m) => m.end !== undefined)
          .map((m) => (
            <span
              key={`span-${m.key}`}
              aria-hidden
              className={cn("absolute inset-y-0 rounded-full", m.effect === "reject" ? "bg-no/35" : "bg-brand/35")}
              style={{ left: pct(m.t), width: `calc(${pct(m.end!)} - ${pct(m.t)})` }}
            />
          ))}
        <span className="absolute inset-y-0 left-0 rounded-full bg-foreground/80" style={{ width: pct(time) }} aria-hidden />
      </div>
      <span
        aria-hidden
        className="pointer-events-none absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-panel bg-foreground"
        style={{ left: pct(time) }}
      />
      {markers.map((m) => (
        <Tooltip key={m.key}>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={() => onMarker(m.key)}
              className={cn(
                "absolute top-1/2 grid size-6 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring",
              )}
              style={{ left: pct(m.t) }}
              aria-label={`${m.label} at ${formatClock(m.t)}. Jump there`}
            >
              <span
                className={cn(
                  "block size-3 rotate-45 rounded-[2px] border-2 border-panel transition-transform",
                  m.effect === "reject" ? "bg-no" : "bg-brand",
                  activeKey === m.key && "scale-150",
                )}
              />
            </button>
          </TooltipTrigger>
          <TooltipContent side="top">
            <span className="font-mono">{formatClock(m.t)}</span> · {m.label}
          </TooltipContent>
        </Tooltip>
      ))}
    </div>
  );
}
