import Link from "next/link";

export function PublicPage({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-5 px-4 py-12">
      <Link href="/" className="text-sm font-semibold tracking-tight">
        Quellix
      </Link>
      <h1 className="text-3xl font-semibold tracking-tight">{title}</h1>
      <div className="flex flex-col gap-4 text-sm leading-6 [&_h2]:mt-4 [&_h2]:text-lg [&_h2]:font-semibold [&_ul]:list-disc [&_ul]:pl-5">
        {children}
      </div>
      <footer className="mt-8 flex gap-4 border-t border-zinc-200 pt-4 text-xs text-zinc-500 dark:border-zinc-800">
        <Link href="/data">How we handle data</Link>
        <Link href="/dpa">DPA</Link>
      </footer>
    </main>
  );
}
