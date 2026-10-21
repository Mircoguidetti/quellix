import Link from "next/link";
import { Logo } from "@/components/logo";

/** Dark, landing-style frame for public pages: data handling, DPA, contest. */
export function PublicShell({ children, wide = false }: { children: React.ReactNode; wide?: boolean }) {
  return (
    <div className="dark relative flex min-h-dvh flex-col overflow-hidden bg-background text-foreground">
      <div
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-[-30%] aspect-square w-[min(900px,150vw)] -translate-x-1/2 bg-[radial-gradient(closest-side,rgba(143,180,255,0.12),rgba(143,180,255,0))]"
      />
      <header className="relative mx-auto flex h-16 w-full max-w-[1120px] items-center justify-between px-4 sm:px-6">
        <Link href="/" className="rounded-md" aria-label="Quellix home">
          <Logo />
        </Link>
      </header>
      <main className={`relative mx-auto w-full flex-1 px-4 pb-20 pt-10 sm:px-6 ${wide ? "max-w-[880px]" : "max-w-[720px]"}`}>{children}</main>
      <footer className="relative mx-auto flex w-full max-w-[1120px] flex-wrap justify-between gap-4 border-t border-border px-4 py-7 text-[14px] text-muted-foreground sm:px-6">
        <span className="font-semibold tracking-[0.14em]">QUELLIX</span>
        <nav aria-label="Footer" className="flex gap-6">
          <Link className="hover:text-foreground" href="/data">
            Data handling
          </Link>
          <Link className="hover:text-foreground" href="/dpa">
            DPA
          </Link>
        </nav>
      </footer>
    </div>
  );
}

export function PublicPage({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <PublicShell>
      <h1 className="text-[clamp(32px,5vw,48px)] font-medium leading-[1.05] tracking-[-0.03em]">{title}</h1>
      <div className="mt-8 flex flex-col gap-4 text-[16px] leading-relaxed text-muted-foreground [&_a]:text-brand [&_a]:underline-offset-4 hover:[&_a]:underline [&_b]:font-medium [&_b]:text-foreground [&_h2]:mt-6 [&_h2]:text-[20px] [&_h2]:font-medium [&_h2]:tracking-[-0.01em] [&_h2]:text-foreground [&_li]:pl-1 [&_strong]:text-foreground [&_ul]:list-disc [&_ul]:pl-5">
        {children}
      </div>
    </PublicShell>
  );
}
