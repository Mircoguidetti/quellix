"use client";

import { useCallback, useLayoutEffect, useRef, useState } from "react";
import type { LucideIcon } from "lucide-react";
import { CircleCheck, CircleX, Copy, Crosshair, Gauge, Hand, ListChecks, Play, ScanFace, UserRoundSearch } from "lucide-react";
import { cn } from "@/lib/utils";
import { ICON } from "../primitives";
import { ClipPlayer, useClips } from "../clip-player";
import { SITE_CLIPS } from "../clips";

/**
 * Product's orchestrated moment: checks on the left, the reasons they can raise in the middle, the
 * three outcomes on the right. Hover, focus or tap a check to light its path, or pick one of the real
 * clips (SITE_CLIPS.decision) to see its path with the worker's output as it is. Static at rest
 * (issue #85): it starts on the reject.
 */

type Outcome = "reject" | "review" | "accept";
type CheckKey = "hands" | "task" | "privacy" | "originality" | "framing" | "technical";

const CHECKS: { key: CheckKey; icon: LucideIcon; label: string; reason: string; code: string; outcome: Outcome; why: string }[] = [
  { key: "hands", icon: Hand, label: "Hands", reason: "Hands not clearly visible", code: "hands_visible.below_min", outcome: "review", why: "The hands check sends to review until it is validated" },
  { key: "task", icon: ListChecks, label: "Task", reason: "Step not confirmed", code: "task_completed.uncertain", outcome: "review", why: "A critical check the model is not sure about goes to a person" },
  { key: "privacy", icon: ScanFace, label: "Privacy", reason: "Document in view", code: "privacy.document", outcome: "review", why: "Your rubric sends documents to review" },
  { key: "originality", icon: Copy, label: "Delivered", reason: "Already delivered", code: "originality.duplicate", outcome: "reject", why: "Similarity above your threshold, set to reject" },
  { key: "framing", icon: Crosshair, label: "Framing", reason: "Off target too long", code: "framing.off_target", outcome: "review", why: "A non-critical check failed" },
  { key: "technical", icon: Gauge, label: "Technical", reason: "Too dark or blurry", code: "technical.bad_exposure", outcome: "reject", why: "Critical check failed with a clear measurement" },
];

// Surface tokens, so the tints pass contrast on the light page.
const COLOR: Record<Outcome, string> = { reject: "var(--brand-no)", review: "var(--brand)", accept: "var(--brand-ok)" };
const tint = (o: Outcome) => `color-mix(in srgb, ${COLOR[o]} 12%, transparent)`;
const OUTCOMES: { key: Outcome; label: string; icon: LucideIcon }[] = [
  { key: "reject", label: "Reject", icon: CircleX },
  { key: "review", label: "Review", icon: UserRoundSearch },
  { key: "accept", label: "Accept", icon: CircleCheck },
];
const OUTCOME_KEYS = OUTCOMES.map((o) => o.key);

/** Nothing lit: a clip that has not loaded yet. */
type Active = { kind: "check"; key: CheckKey } | { kind: "example"; failing: CheckKey[]; passing: CheckKey[]; outcome: Outcome } | { kind: "none" };

/** Decision check names (decision.schema.json) to the diagram's checks. */
const CHECK_OF: Record<string, CheckKey> = {
  hands_visible: "hands",
  task_completed: "task",
  privacy: "privacy",
  originality: "originality",
  framing: "framing",
  technical: "technical",
};
type Edge = { id: string; from: string; to: string; quiet?: boolean };

const EDGES: Edge[] = [
  ...CHECKS.map((c) => ({ id: `c-${c.key}`, from: `check-${c.key}`, to: `reason-${c.key}` })),
  ...CHECKS.map((c) => ({ id: `n-${c.key}`, from: `check-${c.key}`, to: "reason-none" })),
  // Every reason can reach every outcome (a rubric can change each path); unlit, only the default shows.
  ...CHECKS.flatMap((c) => OUTCOME_KEYS.map((o) => ({ id: `r-${c.key}-${o}`, from: `reason-${c.key}`, to: `out-${o}`, quiet: o !== c.outcome }))),
  { id: "r-none", from: "reason-none", to: "out-accept" },
];

/** What is lit for the current state: nodes and edges, with the colour of each edge. */
function lit(active: Active) {
  const nodes = new Set<string>();
  const pass = new Set<string>();
  const edges = new Map<string, string>();
  if (active.kind === "none") return { nodes, pass, edges };
  const failing = active.kind === "check" ? [active.key] : active.failing;
  if (active.kind === "example" && failing.length === 0) {
    // Only checks that ran and passed light up; skipped ones stay dim.
    for (const c of CHECKS) {
      if (!active.passing.includes(c.key)) continue;
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
      // A real video's path ends at its real decision, not at the check's default.
      const out = active.kind === "example" ? active.outcome : c.outcome;
      nodes.add(`check-${c.key}`);
      nodes.add(`reason-${c.key}`);
      nodes.add(`out-${out}`);
      edges.set(`c-${c.key}`, COLOR[out]);
      edges.set(`r-${c.key}-${out}`, COLOR[out]);
    } else if (active.kind === "example" && active.passing.includes(c.key)) pass.add(`check-${c.key}`);
  }
  return { nodes, pass, edges };
}

export function DecisionDiagram() {
  const rootRef = useRef<HTMLDivElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const nodeRefs = useRef(new Map<string, HTMLElement>());
  const [paths, setPaths] = useState<Record<string, string>>({});
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [example, setExample] = useState(SITE_CLIPS.decision.indexOf("clip-01-dark"));
  const [hovered, setHovered] = useState<CheckKey | null>(null);
  const [pinned, setPinned] = useState<CheckKey | null>(null);

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

  const clips = useClips(SITE_CLIPS.decision);
  const exId = SITE_CLIPS.decision[example];
  const exClip = clips[exId];
  const exSide = exClip && exClip !== "missing" && exClip.decision ? exClip : null;
  // The clip's own reasons light the path, and its own decision ends it.
  const exFailing = exSide ? [...new Set(exSide.decision!.reasons.map((r) => CHECK_OF[r.check]).filter(Boolean))] : [];
  const exPassing = Object.entries(exSide?.decision?.checks ?? {})
    .filter(([, v]) => v.status === "pass")
    .map(([k]) => CHECK_OF[k])
    .filter(Boolean);
  const exLine = exSide ? (exSide.decision!.reasons[0]?.message ?? "Every enabled check passed · no reasons") : "Loading…";

  const active: Active = interacting
    ? { kind: "check", key: interacting }
    : exSide
      ? { kind: "example", failing: exFailing, passing: exPassing, outcome: exSide.decision!.decision }
      : { kind: "none" };
  const { nodes, pass, edges } = lit(active);
  const check = interacting ? CHECKS.find((c) => c.key === interacting)! : null;

  return (
    <div ref={rootRef} className="rounded-[24px] border border-hairline bg-panel">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-hairline px-5 py-4 sm:px-7">
        <div className="flex min-h-9 min-w-0 basis-full items-center gap-3 sm:flex-1 sm:basis-auto" aria-live="polite">
          {check ? (
            <>
              <check.icon {...ICON} className="size-4 shrink-0 text-muted-foreground" />
              <p className="min-w-0 text-[14px] sm:truncate">
                <span className="font-mono text-[12.5px] text-muted-foreground">{check.code}</span>
                <span className="mx-2 text-muted-foreground">→</span>
                <span style={{ color: COLOR[check.outcome] }}>{check.outcome}</span>
                <span className="hidden text-muted-foreground sm:inline"> · {check.why}</span>
              </p>
            </>
          ) : (
            <>
              {exSide ? (
                <span className="relative block h-9 w-16 shrink-0 overflow-hidden rounded-md border border-hairline">
                  <ClipPlayer key={exSide.id} side={exSide} />
                </span>
              ) : (
                <Play {...ICON} className="size-4 shrink-0 text-muted-foreground" />
              )}
              <p className="min-w-0 text-[14px] sm:truncate">
                <span className="text-[13.5px]">{exSide?.source?.task ?? exId}</span>
                {exSide ? <span className="ml-2 font-mono text-[12.5px]" style={{ color: COLOR[exSide.decision!.decision] }}>{exSide.decision!.decision}</span> : null}
                <span className="mx-2 text-muted-foreground">·</span>
                <span className="text-[13px] text-muted-foreground">{exLine}</span>
              </p>
            </>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          {SITE_CLIPS.decision.map((id, i) => (
            <button
              key={id}
              type="button"
              aria-label={`Play video ${i + 1}`}
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
          <span className="ml-2 whitespace-nowrap text-[12px] text-muted-foreground">Real clips</span>
        </div>
      </div>

      <div ref={boxRef} className="relative grid grid-cols-[42px_minmax(0,1fr)_96px] gap-x-5 px-3 py-6 sm:grid-cols-[1fr_1.15fr_0.9fr] sm:gap-x-16 sm:px-8 sm:py-10 lg:gap-x-24">
        <svg aria-hidden="true" className="pointer-events-none absolute inset-0" width={size.w} height={size.h}>
          {EDGES.map((e) => {
            const d = paths[e.id];
            if (!d) return null;
            const color = edges.get(e.id);
            if (e.quiet && !color) return null;
            return (
              <path
                key={e.id}
                d={d}
                fill="none"
                stroke={color ?? "var(--hairline)"}
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
            const o = active.kind === "example" ? active.outcome : c.outcome;
            return (
              <li key={c.key} className="flex flex-1 items-center">
                <span
                  ref={register(`reason-${c.key}`)}
                  className={cn(
                    "inline-block max-w-full truncate rounded-md border px-2 py-1 text-[11.5px] transition-colors duration-300 sm:text-[13px]",
                    on ? "text-foreground" : "border-transparent text-muted-foreground/70",
                  )}
                  style={on ? { borderColor: COLOR[o], background: tint(o) } : undefined}
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
                  style={on ? { borderColor: COLOR[o.key], background: tint(o.key), color: COLOR[o.key] } : undefined}
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
