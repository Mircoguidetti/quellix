"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { DOCS_GROUPS } from "./nav";

/** The docs navigation: groups with their pages, the current one highlighted. */
export function DocsSidebarNav({ className }: { className?: string }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Documentation" className={cn("grid gap-7", className)}>
      {DOCS_GROUPS.map((group) => (
        <div key={group.id}>
          <p className="mb-2 px-2.5 font-mono text-[11px] font-medium uppercase tracking-[0.1em] text-muted-foreground">{group.label}</p>
          <ul className="grid gap-0.5">
            {group.items.map((item) => {
              const current = pathname === item.href;
              const Icon = item.icon;
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    aria-current={current ? "page" : undefined}
                    className={cn(
                      "flex items-center gap-2.5 rounded-lg px-2.5 py-[7px] text-[14px] transition-colors",
                      current ? "bg-accent font-medium text-accent-foreground" : "text-foreground/75 hover:bg-muted hover:text-foreground",
                    )}
                  >
                    <Icon className={cn("size-4 shrink-0", current ? "text-accent-foreground" : "text-muted-foreground")} strokeWidth={1.5} aria-hidden />
                    {item.title}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}
