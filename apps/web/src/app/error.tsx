"use client";

import { useEffect } from "react";
import { RotateCcw } from "lucide-react";
import { PublicShell } from "@/components/public-page";
import { Button } from "@/components/ui/button";

export default function RootError({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <PublicShell>
      <h1 className="text-[clamp(32px,5vw,48px)] font-medium leading-[1.05] tracking-[-0.03em]">We could not load your workspace</h1>
      <p className="mt-4 max-w-[56ch] text-[16px] text-muted-foreground">
        Ormes could not reach its database. It is usually a short outage. Try again in a moment; if it keeps happening, contact support and mention the time it happened.
      </p>
      <div className="mt-8 flex flex-wrap gap-3">
        <Button variant="pill" size="xl" onClick={() => retry()}>
          <RotateCcw aria-hidden />
          Try again
        </Button>
        <form action="/auth/signout" method="post">
          <Button type="submit" variant="pill-outline" size="xl">
            Sign out
          </Button>
        </form>
      </div>
    </PublicShell>
  );
}
