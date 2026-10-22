"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/product", label: "Product" },
  { href: "/developers", label: "Developers" },
  { href: "/security", label: "Security" },
];

/** Shared header of the marketing pages: border on scroll, mobile menu, current page. */
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

  return (
    <header className={scrolled ? "nv sc" : "nv"} id="nv">
      <div className="in">
        <Link className="logo" href="/">
          <i aria-hidden="true" />
          ORMES
        </Link>
        <nav className="nn" aria-label="Main">
          {LINKS.map((l) => (
            <Link key={l.href} className="lk" href={l.href} aria-current={pathname === l.href ? "page" : undefined}>
              {l.label}
            </Link>
          ))}
          <Link className="lk si" href="/login">
            Sign in
          </Link>
          <Link className="pill" href="/signup">
            Start a pilot
          </Link>
          <button className="mb" id="mb" type="button" aria-label="Menu" aria-expanded={open} aria-controls="mp" onClick={() => setOpen((o) => !o)}>
            <i />
            <i />
          </button>
        </nav>
      </div>
      <div className={open ? "mp op" : "mp"} id="mp" onClick={(e) => (e.target as HTMLElement).closest("a") && setOpen(false)}>
        {LINKS.map((l) => (
          <Link key={l.href} href={l.href}>
            {l.label}
          </Link>
        ))}
        <Link href="/login">Sign in</Link>
        <Link className="g" href="/signup">
          Start a pilot
        </Link>
      </div>
    </header>
  );
}
