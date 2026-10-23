"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowRight, Menu, X } from "lucide-react";
import { Logo } from "@/components/logo";
import { cn } from "@/lib/utils";
import { ICON } from "./primitives";

export const SITE_LINKS = [
  { href: "/product", label: "Product" },
  { href: "/security", label: "Security" },
  { href: "/docs", label: "Docs" },
];

/** Header of the marketing pages: hairline once scrolled, a menu on small screens, the current page marked. */
export function SiteNav() {
  const pathname = usePathname();
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const current = (href: string) => (pathname === href || pathname.startsWith(`${href}/`) ? "page" : undefined);

  return (
    <header
      className={cn(
        "sticky top-0 z-50 border-b backdrop-blur-xl transition-colors duration-200",
        // Always dark (issue #85), on every page and over light sections; solid, so it never reads grey.
        "surface-dark bg-background",
        scrolled || open ? "border-hairline" : "border-transparent",
      )}
    >
      <div className="mx-auto flex h-16 max-w-[1160px] items-center justify-between gap-4 px-4 sm:px-6">
        <Link href="/" className="rounded-md" aria-label="Ormes home">
          <Logo />
        </Link>
        <nav aria-label="Main" className="flex items-center gap-1">
          <ul className="hidden items-center gap-1 md:flex">
            {SITE_LINKS.map((l) => (
              <li key={l.href}>
                <Link
                  href={l.href}
                  aria-current={current(l.href)}
                  className="rounded-full px-3 py-2 text-[14.5px] text-muted-foreground transition-colors hover:text-foreground aria-[current=page]:text-foreground"
                >
                  {l.label}
                </Link>
              </li>
            ))}
            <li>
              <Link href="/login" className="rounded-full px-3 py-2 text-[14.5px] text-muted-foreground transition-colors hover:text-foreground">
                Sign in
              </Link>
            </li>
          </ul>
          <Link
            href="/signup"
            className="ml-2 inline-flex h-9 items-center gap-1.5 rounded-full bg-foreground px-4 text-[14px] font-medium text-background transition-colors hover:bg-foreground/85"
          >
            Start a pilot
          </Link>
          <button
            type="button"
            className="ml-1 inline-flex size-10 items-center justify-center rounded-full text-foreground hover:bg-foreground/5 md:hidden"
            aria-label={open ? "Close menu" : "Open menu"}
            aria-expanded={open}
            aria-controls="site-menu"
            onClick={() => setOpen((o) => !o)}
          >
            {open ? <X {...ICON} className="size-5" /> : <Menu {...ICON} className="size-5" />}
          </button>
        </nav>
      </div>
      <div id="site-menu" hidden={!open} className="border-t border-hairline md:hidden">
        <ul className="mx-auto flex max-w-[1160px] flex-col px-4 py-3" onClick={(e) => (e.target as HTMLElement).closest("a") && setOpen(false)}>
          {[...SITE_LINKS, { href: "/login", label: "Sign in" }].map((l) => (
            <li key={l.href}>
              <Link
                href={l.href}
                aria-current={current(l.href)}
                className="flex items-center justify-between border-b border-hairline py-3.5 text-[17px] text-muted-foreground aria-[current=page]:text-foreground"
              >
                {l.label}
                <ArrowRight {...ICON} className="size-4" />
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </header>
  );
}
