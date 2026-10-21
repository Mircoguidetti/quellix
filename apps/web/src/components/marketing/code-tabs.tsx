"use client";

import { useId, useRef, useState } from "react";

/**
 * The design's code box: tabs over several `<pre>` panels and a Copy button. Arrow keys move
 * between tabs; Copy falls back to selecting the text when the clipboard is not available.
 */
export function CodeTabs({ className, labels, panels }: { className?: string; labels: string[]; panels: React.ReactNode[] }) {
  const id = useId();
  const [active, setActive] = useState(0);
  const [copied, setCopied] = useState(false);
  const pres = useRef<(HTMLPreElement | null)[]>([]);
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);

  const select = (i: number) => {
    const next = (i + labels.length) % labels.length;
    setActive(next);
    tabs.current[next]?.focus();
  };

  const selectText = (el: HTMLElement) => {
    const range = document.createRange();
    range.selectNodeContents(el);
    const sel = getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
  };

  const copy = async () => {
    const el = pres.current[active];
    if (!el) return;
    try {
      await navigator.clipboard.writeText(el.innerText);
      setCopied(true);
    } catch {
      selectText(el);
    }
    setTimeout(() => setCopied(false), 1600);
  };

  return (
    <div className={className}>
      <div className="tabs">
        {/* The Copy button is not a tab: only the tabs live in the tablist (contents keeps the layout). */}
        <div role="tablist" aria-label="Code language" style={{ display: "contents" }}>
        {labels.map((label, i) => (
          <button
            key={label}
            ref={(el) => {
              tabs.current[i] = el;
            }}
            type="button"
            role="tab"
            id={`${id}-tab-${i}`}
            aria-selected={i === active}
            aria-controls={`${id}-panel-${i}`}
            tabIndex={i === active ? 0 : -1}
            onClick={() => setActive(i)}
            onKeyDown={(e) => {
              if (e.key === "ArrowRight") select(active + 1);
              else if (e.key === "ArrowLeft") select(active - 1);
              else if (e.key === "Home") select(0);
              else if (e.key === "End") select(labels.length - 1);
              else return;
              e.preventDefault();
            }}
          >
            {label}
          </button>
        ))}
        </div>
        <button className="cp" type="button" onClick={copy} aria-live="polite">
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      {panels.map((panel, i) => (
        <pre
          key={i}
          ref={(el) => {
            pres.current[i] = el;
          }}
          role="tabpanel"
          id={`${id}-panel-${i}`}
          aria-labelledby={`${id}-tab-${i}`}
          hidden={i !== active}
          tabIndex={0}
        >
          {panel}
        </pre>
      ))}
    </div>
  );
}
