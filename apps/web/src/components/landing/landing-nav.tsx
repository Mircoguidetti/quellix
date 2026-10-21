"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

const links = [
  { href: "#steps", label: "How it works" },
  { href: "#privacy", label: "Privacy" },
  { href: "#pricing", label: "Pricing" },
];

export function LandingNav() {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header className={`nv${scrolled ? " sc" : ""}`}>
      <div className="in">
        <a className="logo" href="#top">
          <i aria-hidden="true" />
          QUELLIX
        </a>
        <nav className="nn" aria-label="Main">
          {links.map((l) => (
            <a key={l.href} className="lk" href={l.href}>
              {l.label}
            </a>
          ))}
          <Link className="lk si" href="/login">
            Sign in
          </Link>
          <a className="pill" href="#start">
            Request a demo
          </a>
          <button
            className="mb"
            type="button"
            aria-label="Menu"
            aria-expanded={open}
            aria-controls="mp"
            onClick={() => setOpen((o) => !o)}
          >
            <i />
            <i />
          </button>
        </nav>
      </div>
      <div className={`mp${open ? " op" : ""}`} id="mp" onClick={(e) => (e.target as HTMLElement).tagName === "A" && setOpen(false)}>
        {links.map((l) => (
          <a key={l.href} href={l.href}>
            {l.label}
          </a>
        ))}
        <Link href="/login">Sign in</Link>
        <a className="g" href="#start">
          Request a demo
        </a>
      </div>
    </header>
  );
}
