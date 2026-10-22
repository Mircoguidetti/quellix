"use client";

import { useEffect, useState } from "react";
import { AlignLeft } from "lucide-react";
import { cn } from "@/lib/utils";

export type TocItem = { id: string; label: string };

/** The right rail: the page's sections, the one being read highlighted. */
export function OnThisPage({ items }: { items: TocItem[] }) {
  const [active, setActive] = useState(items[0]?.id);

  useEffect(() => {
    const headings = items.map((i) => document.getElementById(i.id)).filter((el): el is HTMLElement => el !== null);
    const visible = new Set<string>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) visible.add(entry.target.id);
          else visible.delete(entry.target.id);
        }
        // The first section whose heading is in the reading band; otherwise keep the last one.
        const first = items.find((i) => visible.has(i.id));
        if (first) setActive(first.id);
        else {
          // Scrolled past every visible heading: pick the last heading above the band.
          const above = headings.filter((h) => h.getBoundingClientRect().top < 120);
          if (above.length) setActive(above[above.length - 1].id);
        }
      },
      { rootMargin: "-72px 0px -60% 0px", threshold: 0 },
    );
    headings.forEach((h) => observer.observe(h));
    return () => observer.disconnect();
  }, [items]);

  return (
    <nav aria-label="On this page" className="text-[13px]">
      <p className="mb-3 flex items-center gap-2 font-mono text-[11px] font-medium uppercase tracking-[0.1em] text-muted-foreground">
        <AlignLeft className="size-3.5" strokeWidth={1.5} aria-hidden />
        On this page
      </p>
      <ul className="grid border-l border-border">
        {items.map((item) => (
          <li key={item.id}>
            <a
              href={`#${item.id}`}
              aria-current={active === item.id ? "location" : undefined}
              onClick={() => setActive(item.id)}
              className={cn(
                "-ml-px block border-l py-1.5 pl-3.5 leading-snug transition-colors",
                active === item.id ? "border-foreground font-medium text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              {item.label}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
