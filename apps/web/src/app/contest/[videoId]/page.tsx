import { Suspense } from "react";
import type { Metadata } from "next";
import { connection } from "next/server";
import { CircleX, SearchX } from "lucide-react";
import { PublicShell } from "@/components/public-page";
import { Skeleton } from "@/components/ui/skeleton";
import { getContestInfo } from "@/lib/domain/contests";
import { createAdminClient } from "@/lib/supabase/admin";
import { ContestForm } from "./contest-form";

export const metadata: Metadata = { title: "Contest a rejection", robots: { index: false } };

export default function ContestPage({ params }: PageProps<"/contest/[videoId]">) {
  return (
    <PublicShell>
      <Suspense
        fallback={
          <div className="grid gap-4" aria-busy="true" aria-label="Loading">
            <Skeleton className="h-12 w-3/4" />
            <Skeleton className="h-28 w-full rounded-2xl" />
            <Skeleton className="h-48 w-full rounded-2xl" />
          </div>
        }
      >
        <Content params={params} />
      </Suspense>
    </PublicShell>
  );
}

async function Content({ params }: { params: PageProps<"/contest/[videoId]">["params"] }) {
  const { videoId } = await params;
  await connection();
  const info = await getContestInfo(createAdminClient(), videoId).catch(() => null);
  if (!info) {
    return (
      <div className="grid justify-items-start gap-4">
        <span className="grid size-11 place-items-center rounded-xl border border-border bg-card text-muted-foreground">
          <SearchX className="size-5" aria-hidden />
        </span>
        <h1 className="text-[clamp(30px,5vw,44px)] font-medium leading-[1.05] tracking-[-0.03em]">Nothing to contest</h1>
        <p className="max-w-[52ch] text-[16px] text-muted-foreground">This link is not valid, or the video was not rejected. If you think it should be here, ask the company that paid you for the video.</p>
      </div>
    );
  }
  return (
    <div className="grid gap-8">
      <div className="grid gap-3">
        <p className="font-mono text-[12px] uppercase tracking-[0.1em] text-muted-foreground">Rejected video</p>
        <h1 className="text-[clamp(30px,5vw,44px)] font-medium leading-[1.05] tracking-[-0.03em]">Contest a rejection</h1>
        <p className="max-w-[56ch] text-[16px] text-muted-foreground">
          If you think this video was rejected by mistake, tell us why. A person reads every message and decides. You do not need an account.
        </p>
      </div>
      <section aria-labelledby="why" className="rounded-2xl border border-border bg-card p-5 sm:p-6">
        <h2 id="why" className="mb-3 font-mono text-[12px] uppercase tracking-[0.1em] text-muted-foreground">
          Why it was rejected
        </h2>
        {info.reasons.length ? (
          <ul className="grid gap-2.5">
            {info.reasons.map((r) => (
              <li key={r} className="flex items-start gap-3 text-[15.5px] leading-snug">
                <CircleX className="mt-0.5 size-[18px] shrink-0 text-reject-fg" aria-hidden />
                {r}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[15px] text-muted-foreground">No detailed reason is available for this video.</p>
        )}
      </section>
      <ContestForm videoId={info.videoId} />
    </div>
  );
}
