"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowUpRight, Menu, X } from "lucide-react";
import { Logo } from "@/components/logo";
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { DocsSidebarNav } from "./sidebar";

const SITE_LINKS = [
  { href: "/product", label: "Product" },
  { href: "/security", label: "Security" },
  { href: "/docs", label: "Docs" },
];

/** Dark top bar of the docs (issue #85: the navbar is always dark). Below `lg` the sidebar moves into a drawer behind the menu button. */
export function DocsHeader() {
  const [open, setOpen] = useState(false);

  return (
    <header className="surface-dark sticky top-0 z-40 border-b border-border bg-background">
      <div className="mx-auto flex h-14 max-w-[1440px] items-center gap-3 px-4 sm:px-6 lg:px-8">
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetTrigger asChild>
            <button
              type="button"
              aria-label="Documentation menu"
              className="-ml-1.5 inline-flex size-9 items-center justify-center rounded-lg text-foreground/80 transition-colors hover:bg-muted lg:hidden"
            >
              <Menu className="size-[18px]" strokeWidth={1.5} aria-hidden />
            </button>
          </SheetTrigger>
          <SheetContent side="left" className="bg-background text-foreground">
            <div className="flex h-14 items-center justify-between border-b border-border px-4">
              <SheetTitle className="font-mono text-[11px] font-medium uppercase tracking-[0.1em] text-muted-foreground">Documentation</SheetTitle>
              <SheetDescription className="sr-only">Pages of the Ormes documentation</SheetDescription>
              <SheetClose className="inline-flex size-9 items-center justify-center rounded-lg text-foreground/80 hover:bg-muted" aria-label="Close menu">
                <X className="size-[18px]" strokeWidth={1.5} aria-hidden />
              </SheetClose>
            </div>
            <div
              className="min-h-0 flex-1 overflow-y-auto px-3 py-6"
              onClick={(e) => {
                if ((e.target as HTMLElement).closest("a")) setOpen(false);
              }}
            >
              <DocsSidebarNav />
              <div className="mt-8 grid gap-0.5 border-t border-border pt-6">
                {SITE_LINKS.filter((l) => l.href !== "/docs").map((l) => (
                  <Link key={l.href} href={l.href} className="rounded-lg px-2.5 py-[7px] text-[14px] text-foreground/75 hover:bg-muted hover:text-foreground">
                    {l.label}
                  </Link>
                ))}
                <Link href="/login" className="rounded-lg px-2.5 py-[7px] text-[14px] text-foreground/75 hover:bg-muted hover:text-foreground">
                  Sign in
                </Link>
              </div>
            </div>
          </SheetContent>
        </Sheet>

        <Link href="/" className="flex items-center gap-2.5 rounded-md text-foreground" aria-label="Ormes home">
          <Logo className="text-[14px]" />
        </Link>
        <span className="rounded-md border border-border px-1.5 py-0.5 font-mono text-[11px] font-medium text-muted-foreground">Docs</span>

        <nav aria-label="Main" className="ml-auto flex items-center gap-1">
          {SITE_LINKS.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              aria-current={l.href === "/docs" ? "page" : undefined}
              className="hidden rounded-lg px-3 py-1.5 text-[14px] text-foreground/70 transition-colors hover:text-foreground aria-[current=page]:font-medium aria-[current=page]:text-foreground lg:inline-flex"
            >
              {l.label}
            </Link>
          ))}
          <Link href="/login" className="hidden rounded-lg px-3 py-1.5 text-[14px] text-foreground/70 transition-colors hover:text-foreground sm:inline-flex">
            Sign in
          </Link>
          <Link
            href="/signup"
            className="group ml-1.5 inline-flex h-8 items-center gap-1 rounded-full bg-foreground px-3.5 text-[13.5px] font-medium text-background transition-colors hover:bg-foreground/85"
          >
            Start a pilot
            <ArrowUpRight className="size-3.5 transition-transform group-hover:-translate-y-px group-hover:translate-x-px" strokeWidth={1.5} aria-hidden />
          </Link>
        </nav>
      </div>
    </header>
  );
}
