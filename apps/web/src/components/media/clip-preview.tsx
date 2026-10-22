"use client";

import { useEffect, useRef, useState } from "react";
import {
  DEFECT_LABEL,
  STATE_COLOR,
  STATE_LABEL,
  boxRect,
  frameAt,
  groupClips,
  sourcesLabel,
  stepAt,
  type ClipManifest,
  type ClipSidecar,
  type HandRow,
} from "@/lib/clip-overlay";

const BASE = "/media/clips";

/** Plays the real clips with the hands model's boxes and the worker's decision on top. */
export function ClipPreview() {
  const [manifest, setManifest] = useState<ClipManifest | null | "missing">(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`${BASE}/manifest.json`)
      .then((r) => (r.ok ? (r.json() as Promise<ClipManifest>) : Promise.reject(new Error(String(r.status)))))
      .then((m) => !cancelled && setManifest(m))
      .catch(() => !cancelled && setManifest("missing"));
    return () => {
      cancelled = true;
    };
  }, []);

  if (manifest === null) return <p className="text-muted-foreground" aria-live="polite">Loading the clips…</p>;
  if (manifest === "missing" || manifest.clips.length === 0) {
    return (
      <p className="rounded-lg border border-dashed p-6 text-muted-foreground">
        No clips yet. Run the &ldquo;Site clips&rdquo; workflow; it commits them to apps/web/public/media/clips.
      </p>
    );
  }
  return (
    <div className="grid gap-10">
      <p className="text-sm text-muted-foreground">
        {manifest.clips.length} clips from {sourcesLabel(manifest.sources ?? [])}, {(manifest.total_bytes / 1e6).toFixed(1)} MB in
        total. Boxes are the hands model&apos;s own output for each frame; the decision is the worker&apos;s verdict on the clip itself.
      </p>
      <div className="grid gap-14">
        {groupClips(manifest.clips).map(({ clip, variants }) => (
          <section key={clip.id} className="grid gap-6">
            <div className="grid gap-10 lg:grid-cols-2">
              <ClipCard id={clip.id} />
            </div>
            {variants.length > 0 ? (
              <div className="grid gap-4">
                <h2 className="text-lg font-medium">
                  The same clip with a synthetic defect, as Ormes returns it
                </h2>
                <div className="grid gap-10 lg:grid-cols-2">
                  {variants.map((v) => (
                    <ClipCard key={v.id} id={v.id} />
                  ))}
                </div>
              </div>
            ) : null}
          </section>
        ))}
      </div>
    </div>
  );
}

function ClipCard({ id }: { id: string }) {
  const [side, setSide] = useState<ClipSidecar | null | "missing">(null);
  const [overlay, setOverlay] = useState(true);
  const video = useRef<HTMLVideoElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [now, setNow] = useState(0);

  useEffect(() => {
    let cancelled = false;
    fetch(`${BASE}/${id}.json`)
      .then((r) => (r.ok ? (r.json() as Promise<ClipSidecar>) : Promise.reject(new Error(String(r.status)))))
      .then((s) => !cancelled && setSide(s))
      .catch(() => !cancelled && setSide("missing"));
    return () => {
      cancelled = true;
    };
  }, [id]);

  useEffect(() => {
    const v = video.current;
    const c = canvas.current;
    if (!v || !c || !side || side === "missing") return;
    let raf = 0;
    const draw = () => {
      const t = v.currentTime;
      const ctx = c.getContext("2d");
      if (ctx) {
        c.width = v.clientWidth;
        c.height = v.clientHeight;
        ctx.clearRect(0, 0, c.width, c.height);
        const frame = overlay ? frameAt(side.hands.frames, t) : null;
        if (frame) {
          for (const hand of [frame.left, frame.right] as HandRow[]) {
            if (!hand.box || hand.state === "absent") continue;
            const r = boxRect(hand.box, c.width, c.height);
            ctx.lineWidth = 2;
            ctx.strokeStyle = STATE_COLOR[hand.state];
            ctx.strokeRect(r.x, r.y, r.w, r.h);
            ctx.fillStyle = STATE_COLOR[hand.state];
            ctx.font = "12px ui-monospace, monospace";
            ctx.fillText(`${STATE_LABEL[hand.state]}${hand.contact === "object" ? " · holding" : ""}`, r.x + 4, Math.max(12, r.y - 4));
          }
        }
      }
      setNow(t);
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [side, overlay]);

  if (side === "missing") return <p className="text-sm text-destructive">Could not load {id}.json</p>;
  if (side === null) return <p className="text-sm text-muted-foreground">Loading {id}…</p>;

  const portrait = side.video.height > side.video.width;
  const step = stepAt(side.steps, now);
  const src = side.source;
  const variant = side.variant ?? null;
  const decision = side.decision;
  return (
    <figure className={`grid gap-3 ${portrait ? "max-w-[390px]" : ""}`}>
      <div className="relative overflow-hidden rounded-lg bg-black">
        <video
          ref={video}
          className="block w-full"
          width={side.video.width}
          height={side.video.height}
          poster={`${BASE}/${side.video.poster}`}
          controls
          muted
          loop
          playsInline
          preload="metadata"
          aria-label={`Example footage ${id}: ${side.source.dataset}, ${side.source.task}`}
        >
          <source src={`${BASE}/${side.video.webm}`} type="video/webm" />
          <source src={`${BASE}/${side.video.mp4}`} type="video/mp4" />
        </video>
        <canvas ref={canvas} className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden="true" />
      </div>
      <figcaption className="grid gap-2 text-sm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="font-medium">
            {id} <span className="font-normal text-muted-foreground">· {side.video.duration_s.toFixed(1)} s</span>
          </span>
          <label className="flex items-center gap-2 text-muted-foreground">
            <input type="checkbox" checked={overlay} onChange={(e) => setOverlay(e.target.checked)} /> Hand boxes
          </label>
        </div>
        <p className="flex flex-wrap gap-x-4 gap-y-1">
          <span>
            <span className="text-muted-foreground">Source:</span>{" "}
            {src.page_url ? (
              <a className="underline underline-offset-2" href={src.page_url} target="_blank" rel="noreferrer">
                {src.dataset}
              </a>
            ) : (
              src.dataset
            )}{" "}
            <span className="text-muted-foreground">({src.license})</span>
          </span>
          {src.author ? (
            <span>
              <span className="text-muted-foreground">Author:</span>{" "}
              {src.author_url ? (
                <a className="underline underline-offset-2" href={src.author_url} target="_blank" rel="noreferrer">
                  {src.author}
                </a>
              ) : (
                src.author
              )}
            </span>
          ) : null}
          <span>
            <span className="text-muted-foreground">Task:</span> {src.task}
          </span>
          {src.orientation ? <span className="text-muted-foreground">{src.orientation}</span> : null}
        </p>
        {variant ? (
          <p>
            <strong>Synthetic defect:</strong> {DEFECT_LABEL[variant.kind]} ({variant.recipe}, {variant.interval_s[0].toFixed(1)}
            –{variant.interval_s[1].toFixed(1)} s of {variant.of}).
          </p>
        ) : null}
        <p>
          Ormes decision: <strong>{decision ? decision.decision : "not available"}</strong>
          {decision && decision.reasons.length === 0 ? " · no reasons to flag" : null}
        </p>
        {decision && decision.reasons.length > 0 ? (
          <ul className="list-disc pl-5 text-muted-foreground">
            {decision.reasons.map((r) => (
              <li key={r.code}>
                {r.message}
                {r.hint ? <span className="block">Hint: {r.hint}</span> : null}
                {r.segments && r.segments.length > 0 ? (
                  <span className="block text-xs">
                    at {r.segments.map((g) => `${g.start_s.toFixed(1)}–${g.end_s.toFixed(1)} s`).join(", ")}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}
        <p className="text-muted-foreground">
          Both hands whole {Math.round(side.selection.both_hands_full * 100)}% of the time, working{" "}
          {Math.round(side.selection.both_hands_working * 100)}%. {side.hands.model}.
        </p>
        {side.steps.length > 0 ? (
          <p className="text-muted-foreground">
            Step: {step ? step.name : "-"}
            {step?.source ? <span className="text-xs"> ({step.source})</span> : null}
          </p>
        ) : null}
      </figcaption>
    </figure>
  );
}
