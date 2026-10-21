import Link from "next/link";
import { Logo } from "@/components/logo";

/** Dark, landing-style frame for sign-in, sign-up, password and onboarding pages. */
export function AuthShell({ children, footer }: { children: React.ReactNode; footer?: React.ReactNode }) {
  return (
    <div className="dark relative flex min-h-dvh flex-col overflow-hidden bg-background text-foreground">
      <div
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-[-18%] aspect-square w-[min(900px,150vw)] -translate-x-1/2 bg-[radial-gradient(closest-side,rgba(143,180,255,0.14),rgba(143,180,255,0))]"
      />
      <header className="relative mx-auto flex h-16 w-full max-w-[1120px] items-center px-4 sm:px-6">
        <Link href="/" className="rounded-md" aria-label="Quellix home">
          <Logo />
        </Link>
      </header>
      <main className="relative flex flex-1 flex-col items-center justify-center px-4 pb-16 pt-6">{children}</main>
      <footer className="relative mx-auto flex w-full max-w-[1120px] flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-6 text-[13px] text-muted-foreground sm:px-6">
        <span>{footer ?? "Your videos are checked, then deleted. Never used for training."}</span>
        <nav aria-label="Legal" className="flex gap-5">
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

export function AuthCard({ title, description, children }: { title: string; description?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="w-full max-w-[400px]">
      <div className="mb-7 text-center">
        <h1 className="text-[28px] font-medium leading-tight tracking-[-0.025em]">{title}</h1>
        {description && <p className="mt-2 text-[15px] text-muted-foreground">{description}</p>}
      </div>
      <div className="rounded-2xl border border-border bg-card p-6 shadow-[0_40px_120px_-40px_rgba(143,180,255,0.25)] sm:p-7">{children}</div>
    </div>
  );
}
