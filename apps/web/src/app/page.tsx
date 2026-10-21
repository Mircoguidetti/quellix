import Link from "next/link";
import { button } from "@/components/ui";

export default function Home() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-5 px-4 text-center">
      <h1 className="text-3xl font-semibold tracking-tight">Quellix</h1>
      <p className="max-w-md text-zinc-600 dark:text-zinc-400">
        Your lab&apos;s spec, applied the same way to every first-person video, so reviewers only see the doubtful ones.
      </p>
      <Link href="/app" className={button("primary")}>
        Open the dashboard
      </Link>
      <nav className="flex gap-4 text-xs text-zinc-500">
        <Link href="/data">How we handle data</Link>
        <Link href="/dpa">DPA</Link>
      </nav>
    </main>
  );
}
