import Link from "next/link";
import { PublicShell } from "@/components/public-page";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <PublicShell>
      <p className="font-mono text-[12px] uppercase tracking-[0.1em] text-muted-foreground">404</p>
      <h1 className="mt-3 text-[clamp(32px,5vw,48px)] font-medium leading-[1.05] tracking-[-0.03em]">This page does not exist</h1>
      <p className="mt-4 max-w-[52ch] text-[16px] text-muted-foreground">The link may be old, or the item was deleted. Start again from the overview.</p>
      <div className="mt-8 flex flex-wrap gap-3">
        <Button asChild variant="pill" size="xl">
          <Link href="/app">Go to the app</Link>
        </Button>
        <Button asChild variant="pill-outline" size="xl">
          <Link href="/">Home</Link>
        </Button>
      </div>
    </PublicShell>
  );
}
