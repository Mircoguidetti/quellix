import { Suspense } from "react";
import Link from "next/link";
import { requireSession } from "@/lib/session";

export default function AppLayout({ children }: LayoutProps<"/app">) {
  return (
    <Suspense fallback={<div className="p-6 text-sm text-zinc-500">Loading…</div>}>
      <Shell>{children}</Shell>
    </Suspense>
  );
}

const nav = [
  { href: "/app", label: "Videos" },
  { href: "/app/upload", label: "Upload" },
  { href: "/app/review", label: "Review" },
  { href: "/app/rubrics", label: "Rubrics" },
  { href: "/app/contests", label: "Contests" },
  { href: "/app/settings", label: "Settings" },
];

async function Shell({ children }: { children: React.ReactNode }) {
  const session = await requireSession();
  return (
    <div className="flex flex-1 flex-col">
      <header className="border-b border-zinc-200 dark:border-zinc-800">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
          <Link href="/app" className="font-semibold tracking-tight">
            Quellix
          </Link>
          <nav className="flex flex-1 flex-wrap gap-x-4 gap-y-1 text-sm text-zinc-600 dark:text-zinc-400">
            {nav.map((n) => (
              <Link key={n.href} href={n.href} className="hover:text-foreground">
                {n.label}
              </Link>
            ))}
          </nav>
          <form action="/auth/signout" method="post" className="flex items-center gap-3 text-xs text-zinc-500">
            <span>{session.orgName}</span>
            <button type="submit" className="underline">
              Sign out
            </button>
          </form>
        </div>
      </header>
      <div className="mx-auto w-full max-w-5xl flex-1 px-4 py-6">{children}</div>
    </div>
  );
}
