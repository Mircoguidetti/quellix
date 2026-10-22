"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { LucideIcon } from "lucide-react";
import { CircleCheck, CircleX, Copy, Crosshair, Gauge, Hand, ListChecks, Play, ScanFace, UserRoundSearch } from "lucide-react";
import { cn } from "@/lib/utils";
import { Example, ICON } from "../primitives";
import { ClipPlayer, useClip } from "../clip-player";
import { SITE_CLIPS } from "../clips";
import { usePlayback } from "../use-playback";

/**
 * Product's orchestrated moment: checks on the left, the reasons they can raise in the middle, the
 * three outcomes on the right. Hover, focus or tap a check to light its path; on its own the
 * diagram plays three example videos through it.
 */

type Outcome = "reject" | "review" | "accept";
type CheckKey = "hands" | "task" | "privacy" | "originality" | "framing" | "technical";

const CHECKS: { key: CheckKey; icon: LucideIcon; label: string; reason: string; code: string; outcome: Outcome; why: string }[] = [
  { key: "hands", icon: Hand, label: "Hands", reason: "Hands below minimum", code: "hands_visible.below_min", outcome: "reject", why: "Critical check failed with a clear measurement" },
  { key: "task", icon: ListChecks, label: "Task", reason: "Step not confirmed", code: "task_completed.uncertain", outcome: "review", why: "A critical check the model is not sure about goes to a person" },
  { key: "privacy", icon: ScanFace, label: "Privacy", reason: "Document in view", code: "privacy.document", outcome: "review", why: "Your rubric sends documents to review" },
  { key: "originality", icon: Copy, label: "Delivered", reason: "Already delivered", code: "originality.duplicate", outcome: "reject", why: "Similarity above your threshold, set to reject" },
  { key: "framing", icon: Crosshair, label: "Framing", reason: "Off target too long", code: "framing.off_target", outcome: "review", why: "A non-critical check failed" },
  { key: "technical", icon: Gauge, label: "Technical", reason: "Too blurry", code: "technical.blur", outcome: "reject", why: "Critical check failed with a clear measurement" },
];

const OUTCOMES: { key: Outcome; label: string; icon: LucideIcon; color: string; bg: string }[] = [
  { key: "reject", label: "Reject", icon: CircleX, color: "#ff8a7a", bg: "rgba(255,138,122,0.12)" },
  { key: "review", label: "Review", icon: UserRoundSearch, color: "#8fb4ff", bg: "rgba(143,180,255,0.12)" },
  { key: "accept", label: "Accept", icon: CircleCheck, color: "#7ed6a8", bg: "rgba(126,214,168,0.12)" },
];
const COLOR: Record<Outcome, string> = { reject: "#ff8a7a", review: "#8fb4ff", accept: "#7ed6a8" };

const EXAMPLES: { id: string; failing: CheckKey[]; outcome: Outcome; line: string }[] = [
  { id: "v_88214", failing: ["hands"], outcome: "reject", line: "hands visible 61% · minimum 80% · critical" },
  { id: "v_89163", failing: ["privacy"], outcome: "review", line: "readable document at 00:27 · documents: review" },
  { id: "v_88213", failing: [], outcome: "accept", line: "every enabled check passed · no reasons" },
];

type Active = { kind: "check"; key: CheckKey } | { kind: "example"; failing: CheckKey[] };

/** Decision check names (decision.schema.json) to the diagram's checks. */
const CHECK_OF: Record<string, CheckKey> = {
  hands_visible: "hands",
  task_completed: "task",
  privacy: "privacy",
  originality: "originality",
  framing: "framing",
  technical: "technical",
};
type Edge = { id: string; from: string; to: string };

const EDGES: Edge[] = [
  ...CHECKS.map((c) => ({ id: `c-${c.key}`, from: `check-${c.key}`, to: `reason-${c.key}` })),
  ...CHECKS.map((c) => ({ id: `n-${c.key}`, from: `check-${c.key}`, to: "reason-none" })),
  ...CHECKS.map((c) => ({ id: `r-${c.key}`, from: `reason-${c.key}`, to: `out-${c.outcome}` })),
  { id: "r-none", from: "reason-none", to: "out-accept" },
];

/** What is lit for the current state: nodes and edges, with the colour of each edge. */
function lit(active: Active) {
  const nodes = new Set<string>();
  const pass = new Set<string>();
  const edges = new Map<string, string>();
  const failing = active.kind === "check" ? [active.key] : active.failing;
  if (active.kind === "example" && failing.length === 0) {
    for (const c of CHECKS) {
      pass.add(`check-${c.key}`);
      edges.set(`n-${c.key}`, COLOR.accept);
    }
    nodes.add("reason-none");
    nodes.add("out-accept");
    edges.set("r-none", COLOR.accept);
    return { nodes, pass, edges };
  }
  for (const c of CHECKS) {
    if (failing.includes(c.key)) {
      nodes.add(`check-${c.key}`);
      nodes.add(`reason-${c.key}`);
      nodes.add(`out-${c.outcome}`);
      edges.set(`c-${c.key}`, COLOR[c.outcome]);
      edges.set(`r-${c.key}`, COLOR[c.outcome]);
    } else if (active.kind === "example") pass.add(`check-${c.key}`);
  }
  return { nodes, pass, edges };
}

export function DecisionDiagram() {
  const rootRef = useRef<HTMLDivElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const nodeRefs = useRef(new Map<string, HTMLElement>());
  const [paths, setPaths] = useState<Record<string, string>>({});
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [example, setExample] = useState(0);
  const [hovered, setHovered] = useState<CheckKey | null>(null);
  const [pinned, setPinned] = useState<CheckKey | null>(null);
  const playing = usePlayback(rootRef);

  const register = useCallback(
    (id: string) => (el: HTMLElement | null) => {
      if (el) nodeRefs.current.set(id, el);
      else nodeRefs.current.delete(id);
    },
    [],
  );

  // Connectors follow the real positions of the nodes, so the layout can reflow freely.
  useLayoutEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    const measure = () => {
      const b = box.getBoundingClientRect();
      const next: Record<string, string> = {};
      for (const e of EDGES) {
        const a = nodeRefs.current.get(e.from)?.getBoundingClientRect();
        const z = nodeRefs.current.get(e.to)?.getBoundingClientRect();
        if (!a || !z) continue;
        const x1 = a.right - b.left;
        const y1 = a.top + a.height / 2 - b.top;
        const x2 = z.left - b.left;
        const y2 = z.top + z.height / 2 - b.top;
        const mx = (x1 + x2) / 2;
        next[e.id] = `M ${x1} ${y1} C ${mx} ${y1} ${mx} ${y2} ${x2} ${y2}`;
      }
      setPaths(next);
      setSize({ w: b.width, h: b.height });
    };
    measure();
    void document.fonts?.ready.then(measure);
    const ro = new ResizeObserver(measure);
    ro.observe(box);
    return () => ro.disconnect();
  }, []);

  const interacting = hovered ?? pinned;
  useEffect(() => {
    if (!playing || interacting) return;
    const t = window.setInterval(() => setExample((i) => (i + 1) % EXAMPLES.length), 3600);
    return () => clearInterval(t);
  }, [playing, interacting]);

  // Real clips for the three examples, when #60's footage is configured.
  const clips = { reject: useClip(SITE_CLIPS.decision.reject), review: useClip(SITE_CLIPS.decision.review), accept: useClip(SITE_CLIPS.decision.accept) };

  const ex = EXAMPLES[example];
  const exClip = clips[ex.outcome];
  const exSide = exClip && exClip !== "missing" && exClip.decision ? exClip : null;
  // With a real clip, its own reasons light the path.
  const exFailing = exSide ? [...new Set(exSide.decision!.reasons.map((r) => CHECK_OF[r.check]).filter(Boolean))] : ex.failing;
  const exLine = exSide ? (exSide.decision!.reasons[0]?.message ?? "every enabled check passed · no reasons") : ex.line;

  const active: Active = interacting ? { kind: "check", key: interacting } : { kind: "example", failing: exFailing };
  const { nodes, pass, edges } = lit(active);
  const check = interacting ? CHECKS.find((c) => c.key === interacting)! : null;

  return (
    <div ref={rootRef} className="rounded-[24px] border border-hairline bg-panel">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-hairline px-5 py-4 sm:px-7">
        <div className="flex min-w-0 items-center gap-3" aria-live="polite">
          {check ? (
            <>
              <check.icon {...ICON} className="size-4 shrink-0 text-muted-foreground" />
              <p className="min-w-0 text-[14px]">
                <span className="font-mono text-[12.5px] text-muted-foreground">{check.code}</span>
                <span className="mx-2 text-muted-foreground">→</span>
                <span style={{ color: COLOR[check.outcome] }}>{check.outcome}</span>
                <span className="hidden text-muted-foreground sm:inline"> · {check.why}</span>
              </p>
            </>
          ) : (
            <>
              {exSide ? (
                <span className="relative block aspect-video w-24 shrink-0 overflow-hidden rounded-md border border-hairline">
                  <ClipPlayer key={exSide.id} side={exSide} />
                </span>
              ) : (
                <Play {...ICON} className="size-4 shrink-0 text-muted-foreground" />
              )}
              <p className="min-w-0 text-[14px]">
                <span className="font-mono text-[13px]">{exSide ? exSide.id : ex.id}</span>
                <span className="mx-2 text-muted-foreground">·</span>
                <span className="font-mono text-[12.5px] text-muted-foreground">{exLine}</span>
              </p>
            </>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          {EXAMPLES.map((e, i) => (
            <button
              key={e.id}
              type="button"
              aria-label={`Play example ${e.id}`}
              aria-pressed={!interacting && i === example}
              onClick={() => {
                setPinned(null);
                setExample(i);
              }}
              className="flex h-7 items-center rounded-full px-1.5"
            >
              <span className={cn("block h-1.5 rounded-full transition-all", !interacting && i === example ? "w-6 bg-foreground" : "w-1.5 bg-foreground/25")} />
            </button>
          ))}
          <Example className="ml-2">Examples</Example>
        </div>
      </div>

      <div ref={boxRef} className="relative grid grid-cols-[42px_minmax(0,1fr)_96px] gap-x-5 px-3 py-6 sm:grid-cols-[1fr_1.15fr_0.9fr] sm:gap-x-16 sm:px-8 sm:py-10 lg:gap-x-24">
        <svg aria-hidden="true" className="pointer-events-none absolute inset-0" width={size.w} height={size.h}>
          {EDGES.map((e) => {
            const d = paths[e.id];
            if (!d) return null;
            const color = edges.get(e.id);
            return (
              <path
                key={e.id}
                d={d}
                fill="none"
                stroke={color ?? "rgba(255,255,255,0.08)"}
                strokeWidth={color ? 1.75 : 1}
                strokeDasharray={e.id.startsWith("n-") && !color ? "2 4" : undefined}
                className="transition-[stroke,stroke-width] duration-300"
              />
            );
          })}
        </svg>

        <ul className="relative flex flex-col gap-2.5" aria-label="Checks">
          {CHECKS.map((c) => {
            const on = nodes.has(`check-${c.key}`);
            const ok = pass.has(`check-${c.key}`);
            return (
              <li key={c.key}>
                <button
                  ref={register(`check-${c.key}`)}
                  type="button"
                  aria-pressed={pinned === c.key}
                  onMouseEnter={() => setHovered(c.key)}
                  onMouseLeave={() => setHovered(null)}
                  onFocus={() => setHovered(c.key)}
                  onBlur={() => setHovered(null)}
                  onClick={() => setPinned((p) => (p === c.key ? null : c.key))}
                  className={cn(
                    "flex w-full items-center justify-center gap-2 rounded-xl border px-2 py-2 text-left text-[13px] transition-colors duration-300 sm:justify-start sm:gap-2.5 sm:px-3 sm:text-[14.5px]",
                    on ? "border-foreground/40 bg-foreground/[0.07] text-foreground" : ok ? "border-ok/30 text-foreground" : "border-hairline text-muted-foreground hover:text-foreground",
                  )}
                >
                  <c.icon {...ICON} className={cn("size-4 shrink-0", ok && "text-ok")} />
                  <span className="sr-only truncate sm:not-sr-only">{c.label}</span>
                </button>
              </li>
            );
          })}
        </ul>

        <ul className="relative flex flex-col justify-between gap-1.5" aria-label="Reasons">
          {CHECKS.map((c) => {
            const on = nodes.has(`reason-${c.key}`);
            return (
              <li key={c.key} className="flex flex-1 items-center">
                <span
                  ref={register(`reason-${c.key}`)}
                  className={cn(
                    "inline-block max-w-full truncate rounded-md border px-2 py-1 text-[11.5px] transition-colors duration-300 sm:text-[13px]",
                    on ? "text-foreground" : "border-transparent text-muted-foreground/70",
                  )}
                  style={on ? { borderColor: COLOR[c.outcome], background: `${COLOR[c.outcome]}1f` } : undefined}
                >
                  {c.reason}
                </span>
              </li>
            );
          })}
          <li className="flex flex-1 items-center">
            <span
              ref={register("reason-none")}
              className={cn(
                "inline-block rounded-md border border-dashed px-2 py-1 text-[11.5px] transition-colors duration-300 sm:text-[13px]",
                nodes.has("reason-none") ? "border-ok text-ok" : "border-foreground/15 text-muted-foreground/70",
              )}
            >
              No reasons
            </span>
          </li>
        </ul>

        <ul className="relative flex flex-col justify-center gap-6 sm:gap-10" aria-label="Outcomes">
          {OUTCOMES.map((o) => {
            const on = nodes.has(`out-${o.key}`);
            return (
              <li key={o.key}>
                <span
                  ref={register(`out-${o.key}`)}
                  className={cn(
                    "flex items-center gap-2 rounded-xl border px-2.5 py-2.5 text-[13px] font-medium transition-all duration-300 sm:px-4 sm:py-3 sm:text-[16px]",
                    on ? "scale-[1.04]" : "border-hairline text-muted-foreground",
                  )}
                  style={on ? { borderColor: o.color, background: o.bg, color: o.color } : undefined}
                >
                  <o.icon {...ICON} className="size-4 shrink-0 sm:size-5" />
                  {o.label}
                </span>
              </li>
            );
          })}
        </ul>
      </div>
      <p className="border-t border-hairline px-5 py-3 text-[13px] text-muted-foreground sm:px-7">
        <span className="pointer-coarse:hidden">Hover a check to see where its failure leads.</span>
        <span className="hidden pointer-coarse:inline">Tap a check to see where its failure leads.</span> Defaults shown; your rubric can change each path.
      </p>
    </div>
  );
}
