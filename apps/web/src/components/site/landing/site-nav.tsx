"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

const LINKS = [
  { href: "/product", label: "Product" },
  { href: "/security", label: "Security" },
  { href: "/docs", label: "Docs" },
];

/** Shared marketing navbar. Desktop: links + sign in + pilot button. Mobile: wordmark + hamburger with a dropdown. */
export function SiteNav({ current }: { current?: string }) {
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

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

  return (
    <header className={`nav${scrolled ? " scrolled" : ""}${open ? " open" : ""}`}>
      <div className="wrap">
        <Link className="logo" href="/">
          <i />
          ORMES
        </Link>
        <ul>
          {LINKS.map((l) => (
            <li key={l.href}>
              <Link href={l.href} style={current === l.href ? { color: "#fff" } : undefined}>
                {l.label}
              </Link>
            </li>
          ))}
        </ul>
        <div className="actions">
          <Link className="link" href="/login">Sign in ↗</Link>
          <Link className="btn" href="/signup">Start a pilot</Link>
        </div>
        <button
          type="button"
          className="burger"
          aria-label={open ? "Close menu" : "Open menu"}
          aria-expanded={open}
          aria-controls="mobile-menu"
          onClick={() => setOpen((o) => !o)}
        >
          <span />
          <span />
        </button>
      </div>
      <nav id="mobile-menu" className="sheet" hidden={!open}>
        {LINKS.map((l) => (
          <Link key={l.href} href={l.href} onClick={() => setOpen(false)}>
            {l.label}
          </Link>
        ))}
        <Link href="/login" onClick={() => setOpen(false)}>Sign in</Link>
        <Link href="/signup" onClick={() => setOpen(false)}>Start a pilot</Link>
      </nav>
    </header>
  );
}
