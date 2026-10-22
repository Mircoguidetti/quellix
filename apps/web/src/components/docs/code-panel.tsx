"use client";

import { useId, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { Check, Copy } from "lucide-react";
import { cn } from "@/lib/utils";

// The reader's language choice, shared by every code block and remembered across pages.
const STORAGE_KEY = "ormes-docs-language";
const listeners = new Set<() => void>();
let memory: string | null = null;

function readLanguage(): string | null {
  if (memory) return memory;
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function writeLanguage(value: string) {
  memory = value;
  try {
    window.localStorage.setItem(STORAGE_KEY, value);
  } catch {
    // Private mode or blocked storage: the choice still holds for this page.
  }
  listeners.forEach((notify) => notify());
}

function subscribe(notify: () => void) {
  listeners.add(notify);
  window.addEventListener("storage", notify);
  return () => {
    listeners.delete(notify);
    window.removeEventListener("storage", notify);
  };
}

export type PanelTab = { id: string; label: string; code: string; content: ReactNode };

/** Tabs + copy for one code block. Arrow keys move between tabs. */
export function CodePanel({ tabs, title }: { tabs: PanelTab[]; title?: string }) {
  const uid = useId();
  const preferred = useSyncExternalStore(subscribe, readLanguage, () => null);
  const active = Math.max(0, tabs.findIndex((t) => t.id === preferred));
  const [copied, setCopied] = useState(false);
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const preRefs = useRef<(HTMLPreElement | null)[]>([]);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const select = (i: number, focus = false) => {
    const next = (i + tabs.length) % tabs.length;
    writeLanguage(tabs[next].id);
    if (focus) tabRefs.current[next]?.focus();
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(tabs[active].code);
    } catch {
      // No clipboard access: select the code so the reader can copy it by hand.
      const pre = preRefs.current[active];
      if (pre) {
        const range = document.createRange();
        range.selectNodeContents(pre);
        const selection = window.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
      }
      return;
    }
    setCopied(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 1600);
  };

  const showTabs = tabs.length > 1;

  return (
    <div className="my-6 min-w-0 overflow-hidden rounded-xl border border-[#1d2025] bg-panel text-[#e6e8eb] shadow-[0_1px_0_rgba(0,0,0,0.04)]" data-code-block="">
      <div className="flex h-11 items-center gap-1 border-b border-[#1d2025] pl-2 pr-1.5">
        {showTabs ? (
          <div role="tablist" aria-label="Code language" className="flex min-w-0 items-center gap-0.5 overflow-x-auto [scrollbar-width:none]">
            {tabs.map((tab, i) => (
              <button
                key={tab.id}
                ref={(el) => {
                  tabRefs.current[i] = el;
                }}
                type="button"
                role="tab"
                id={`${uid}-tab-${i}`}
                aria-selected={i === active}
                aria-controls={`${uid}-panel-${i}`}
                tabIndex={i === active ? 0 : -1}
                onClick={() => select(i)}
                onKeyDown={(e) => {
                  if (e.key === "ArrowRight") select(i + 1, true);
                  else if (e.key === "ArrowLeft") select(i - 1, true);
                  else return;
                  e.preventDefault();
                }}
                className={cn(
                  "relative h-8 shrink-0 rounded-md px-2.5 font-mono text-[12px] transition-colors",
                  i === active ? "bg-white/[0.08] text-white" : "text-[#8d939c] hover:text-white",
                )}
              >
                {tab.label}
              </button>
            ))}
          </div>
        ) : (
          <span className="truncate px-2 font-mono text-[12px] text-[#8d939c]">{title ?? tabs[0]?.label}</span>
        )}
        {showTabs && title ? <span className="ml-2 hidden truncate font-mono text-[12px] text-[#5c626b] sm:inline">{title}</span> : null}
        <button
          type="button"
          onClick={copy}
          aria-label={copied ? "Copied" : "Copy code"}
          className="ml-auto inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md px-2.5 font-mono text-[12px] text-[#8d939c] transition-colors hover:bg-white/[0.06] hover:text-white"
        >
          {copied ? (
            <Check className="size-3.5 text-ok animate-in zoom-in-50 fade-in duration-200" strokeWidth={1.5} aria-hidden />
          ) : (
            <Copy className="size-3.5" strokeWidth={1.5} aria-hidden />
          )}
          <span aria-live="polite">{copied ? "Copied" : "Copy"}</span>
        </button>
      </div>
      {tabs.map((tab, i) => (
        <div
          key={tab.id}
          role={showTabs ? "tabpanel" : undefined}
          id={`${uid}-panel-${i}`}
          aria-labelledby={showTabs ? `${uid}-tab-${i}` : undefined}
          hidden={i !== active}
          className={cn(showTabs && "animate-in fade-in duration-200")}
        >
          <pre
            ref={(el) => {
              preRefs.current[i] = el;
            }}
            tabIndex={0}
            className="overflow-x-auto px-4 py-4 font-mono text-[13px] leading-[1.7] outline-none [tab-size:2] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
          >
            <code>{tab.content}</code>
          </pre>
        </div>
      ))}
    </div>
  );
}
