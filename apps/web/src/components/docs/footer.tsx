import Link from "next/link";
import { Logo } from "@/components/logo";

const LINKS = [
  { href: "/product", label: "Product" },
  { href: "/security", label: "Security" },
  { href: "/docs", label: "Docs" },
  { href: "/data", label: "Data handling" },
  { href: "/dpa", label: "DPA" },
];

export function DocsFooter() {
  return (
    <footer className="surface-dark">
      <div className="mx-auto flex max-w-[1440px] flex-col gap-5 px-4 py-8 sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:px-8">
        <div className="flex items-center gap-4 text-foreground">
          <Logo className="text-[13px]" />
          <span className="text-[13px] text-muted-foreground">Acceptance for first-person video.</span>
        </div>
        <nav aria-label="Footer" className="flex flex-wrap gap-x-5 gap-y-2 text-[13.5px]">
          {LINKS.map((l) => (
            <Link key={l.href} href={l.href} className="text-muted-foreground transition-colors hover:text-foreground">
              {l.label}
            </Link>
          ))}
        </nav>
      </div>
    </footer>
  );
}
