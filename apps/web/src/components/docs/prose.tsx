import Link from "next/link";
import type { ReactNode } from "react";
import { CircleAlert, Clock3, Hash, Info, Lightbulb, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/** Section heading with an anchor; its id feeds "On this page". */
export function H2({ id, children, className }: { id: string; children: ReactNode; className?: string }) {
  return (
    <h2 id={id} className={cn("group mt-14 scroll-mt-24 text-[22px] font-semibold leading-tight tracking-[-0.015em] first:mt-0", className)}>
      <a href={`#${id}`} className="inline-flex items-center gap-2 outline-none focus-visible:underline">
        {children}
        <Hash className="size-4 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100" strokeWidth={1.5} aria-hidden />
      </a>
    </h2>
  );
}

export function H3({ id, children }: { id?: string; children: ReactNode }) {
  return (
    <h3 id={id} className="mt-9 scroll-mt-24 text-[17px] font-semibold tracking-[-0.01em]">
      {children}
    </h3>
  );
}

export function P({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cn("mt-4 text-[15.5px] leading-[1.75] text-foreground/85", className)}>{children}</p>;
}

export function Ul({ children }: { children: ReactNode }) {
  return <ul className="mt-4 grid gap-2 pl-5 text-[15.5px] leading-[1.7] text-foreground/85 marker:text-muted-foreground [list-style:disc]">{children}</ul>;
}

/** Inline code. */
export function C({ children }: { children: ReactNode }) {
  return <code className="rounded-[5px] border border-border bg-subtle px-1.5 py-px font-mono text-[0.86em] text-foreground [overflow-wrap:anywhere]">{children}</code>;
}

export function A({ href, children }: { href: string; children: ReactNode }) {
  const cls = "font-medium text-accent-foreground underline decoration-accent-foreground/30 underline-offset-[3px] transition-colors hover:decoration-accent-foreground";
  return href.startsWith("/") || href.startsWith("#") ? (
    <Link href={href} className={cls}>
      {children}
    </Link>
  ) : (
    <a href={href} className={cls}>
      {children}
    </a>
  );
}

const CALLOUTS: Record<"note" | "warning" | "tip", { icon: LucideIcon; box: string; icon_: string; label: string }> = {
  note: { icon: Info, box: "border-[#d9e3fb] bg-accent/60", icon_: "text-accent-foreground", label: "Note" },
  warning: { icon: CircleAlert, box: "border-[#f6d3cc] bg-reject-bg/70", icon_: "text-reject-fg", label: "Important" },
  tip: { icon: Lightbulb, box: "border-[#cdebd9] bg-accept-bg/70", icon_: "text-accept-fg", label: "Tip" },
};

export function Callout({ kind = "note", title, children }: { kind?: keyof typeof CALLOUTS; title?: string; children: ReactNode }) {
  const c = CALLOUTS[kind];
  const Icon = c.icon;
  return (
    <aside className={cn("mt-6 flex gap-3 rounded-xl border px-4 py-3.5", c.box)} aria-label={title ?? c.label}>
      <Icon className={cn("mt-[3px] size-4 shrink-0", c.icon_)} strokeWidth={1.5} aria-hidden />
      <div className="min-w-0 text-[14.5px] leading-[1.65] text-foreground/85">
        {title ? <p className="font-semibold text-foreground">{title}</p> : null}
        <div className={cn(title && "mt-0.5")}>{children}</div>
      </div>
    </aside>
  );
}

/** Marks something that is not built yet. */
export function Soon({ className }: { className?: string }) {
  return (
    <span className={cn("ml-1.5 inline-flex translate-y-[-1px] items-center gap-1 rounded-full border border-border bg-subtle px-1.5 py-px align-middle font-mono text-[10.5px] font-medium uppercase tracking-[0.06em] text-muted-foreground", className)}>
      <Clock3 className="size-3" strokeWidth={1.5} aria-hidden />
      Soon
    </span>
  );
}

export type Field = { name: string; type: string; default?: string; required?: boolean; description: ReactNode };

/** Field / type / default / description, scrolling inside itself on narrow screens. */
export function FieldTable({ fields, caption, showDefault = true }: { fields: Field[]; caption?: string; showDefault?: boolean }) {
  return (
    <div className="mt-5 overflow-x-auto rounded-xl border border-border">
      <table className="w-full min-w-[560px] border-collapse text-left text-[14px] [&_td:last-child_code]:whitespace-nowrap">
        {caption ? <caption className="sr-only">{caption}</caption> : null}
        <thead className="bg-subtle text-[12px] text-muted-foreground">
          <tr>
            <th scope="col" className="px-4 py-2.5 font-mono font-medium uppercase tracking-[0.06em]">Field</th>
            <th scope="col" className="px-4 py-2.5 font-mono font-medium uppercase tracking-[0.06em]">Type</th>
            {showDefault ? <th scope="col" className="px-4 py-2.5 font-mono font-medium uppercase tracking-[0.06em]">Default</th> : null}
            <th scope="col" className="px-4 py-2.5 font-mono font-medium uppercase tracking-[0.06em]">Description</th>
          </tr>
        </thead>
        <tbody>
          {fields.map((f) => (
            <tr key={f.name} className="border-t border-border align-top">
              <td className="whitespace-nowrap px-4 py-3 font-mono text-[13px] font-medium text-foreground">
                {f.name}
                {f.required ? <span className="ml-1.5 text-[11px] font-normal text-reject-fg">required</span> : null}
              </td>
              <td className="px-4 py-3 font-mono text-[12.5px] text-muted-foreground">{f.type.replace(/ (?=[≥≤0-9])/g, "\u00a0")}</td>
              {showDefault ? <td className="whitespace-nowrap px-4 py-3 font-mono text-[12.5px] text-foreground/80">{f.default ?? "—"}</td> : null}
              <td className="px-4 py-3 leading-[1.6] text-foreground/85">{f.description}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** A plain table for non-field data (errors, limits, statuses). */
export function DataTable({ head, rows, caption, minWidth = 520 }: { head: string[]; rows: ReactNode[][]; caption?: string; minWidth?: number }) {
  return (
    <div className="mt-5 overflow-x-auto rounded-xl border border-border">
      <table className="w-full border-collapse text-left text-[14px] [&_code]:whitespace-nowrap [&_code]:[overflow-wrap:normal]" style={{ minWidth }}>
        {caption ? <caption className="sr-only">{caption}</caption> : null}
        <thead className="bg-subtle text-[12px] text-muted-foreground">
          <tr>
            {head.map((h) => (
              <th key={h} scope="col" className="px-4 py-2.5 font-mono font-medium uppercase tracking-[0.06em]">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className="border-t border-border align-top">
              {row.map((cell, j) => (
                <td key={j} className={cn("px-4 py-3 leading-[1.6]", j === 0 ? "whitespace-nowrap font-mono text-[13px] text-foreground" : "text-foreground/85")}>
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const METHOD_TONE: Record<string, string> = {
  GET: "bg-accept-bg text-accept-fg",
  POST: "bg-review-bg text-review-fg",
  PUT: "bg-[#fbf0dc] text-[#8a5300]",
};

export function Method({ method }: { method: "GET" | "POST" | "PUT" }) {
  return <span className={cn("inline-flex h-6 w-12 shrink-0 items-center justify-center rounded-md font-mono text-[11.5px] font-semibold tracking-[0.04em]", METHOD_TONE[method])}>{method}</span>;
}

/** An endpoint row: method badge, path, optional SDK call. */
export function Endpoint({ method, path, sdk }: { method: "GET" | "POST" | "PUT"; path: string; sdk?: { ts: string; py: string } }) {
  return (
    <div className="mt-5 rounded-xl border border-border bg-subtle">
      <div className="flex min-w-0 items-center gap-3 px-3.5 py-2.5">
        <Method method={method} />
        <code className="min-w-0 font-mono text-[14px] font-medium text-foreground [overflow-wrap:anywhere]">{path}</code>
      </div>
      {sdk ? (
        <div className="flex flex-wrap gap-x-5 gap-y-1 border-t border-border px-3.5 py-2 font-mono text-[12px] text-muted-foreground">
          <span>
            <span className="text-muted-foreground/70">TS </span>
            <span className="text-foreground/80">{sdk.ts}</span>
          </span>
          <span>
            <span className="text-muted-foreground/70">Py </span>
            <span className="text-foreground/80">{sdk.py}</span>
          </span>
        </div>
      ) : null}
    </div>
  );
}

/** Numbered steps with a rail; each step's heading is an H2 so it shows in "On this page". */
export function Steps({ children }: { children: ReactNode }) {
  return <ol className="relative mt-10 grid grid-cols-[minmax(0,1fr)] gap-12 [counter-reset:step]">{children}</ol>;
}

export function Step({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <li className="relative min-w-0 sm:pl-11 [counter-increment:step] max-sm:after:hidden before:absolute before:left-0 before:top-0 before:grid before:size-7 before:place-items-center before:rounded-full before:border before:border-border before:bg-background before:font-mono before:text-[12.5px] before:font-medium before:text-foreground before:content-[counter(step)] after:absolute after:bottom-[-36px] after:left-[13.5px] after:top-9 after:w-px after:bg-border last:after:hidden">
      <H2 id={id} className="mt-0 min-h-7 text-[20px] max-sm:pl-10">
        {title}
      </H2>
      {children}
    </li>
  );
}
