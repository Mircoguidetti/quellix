import Link from "next/link";
import { Logo } from "@/components/logo";

const LINKS = [
  { href: "/product", label: "Product" },
  { href: "/security", label: "Security" },
  { href: "/docs", label: "Docs" },
  { href: "/data", label: "Data handling" },
  { href: "/dpa", label: "DPA" },
];

/** Footer of the marketing pages. */
export function SiteFooter() {
  return (
    <footer className="surface-dark border-t border-hairline">
      <div className="mx-auto flex max-w-[1160px] flex-col gap-6 px-4 py-10 sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <div className="flex flex-col gap-2">
          <Link href="/" className="w-fit rounded-md" aria-label="Ormes home">
            <Logo />
          </Link>
          <p className="text-[13.5px] text-muted-foreground">Accept, reject or review for first-person video.</p>
        </div>
        <nav aria-label="Footer">
          <ul className="flex flex-wrap gap-x-6 gap-y-3 text-[14px] text-muted-foreground">
            {LINKS.map((l) => (
              <li key={l.href}>
                <Link href={l.href} className="transition-colors hover:text-foreground">
                  {l.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </div>
    </footer>
  );
}
