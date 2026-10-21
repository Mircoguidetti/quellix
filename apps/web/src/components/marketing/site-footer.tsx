import Link from "next/link";

/** Shared footer of the marketing pages (docs/design/site). */
export function SiteFooter() {
  return (
    <footer className="ft">
      <span>QUELLIX</span>
      <nav className="cols" aria-label="Footer">
        <Link href="/product">Product</Link>
        <Link href="/developers">Developers</Link>
        <Link href="/security">Security</Link>
        <Link href="/data">Data handling</Link>
        <Link href="/dpa">DPA</Link>
      </nav>
    </footer>
  );
}
