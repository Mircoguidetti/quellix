import { Suspense } from "react";
import { getContestInfo } from "@/lib/domain/contests";
import { createAdminClient } from "@/lib/supabase/admin";
import { ContestForm } from "./contest-form";

export const metadata = { title: "Contest a rejection · Quellix", robots: { index: false } };

export default function ContestPage({ params }: PageProps<"/contest/[videoId]">) {
  return (
    <main className="mx-auto flex w-full max-w-lg flex-1 flex-col gap-5 px-4 py-12">
      <Suspense fallback={<p className="text-sm text-zinc-500">Loading…</p>}>
        <Content params={params} />
      </Suspense>
    </main>
  );
}

async function Content({ params }: { params: PageProps<"/contest/[videoId]">["params"] }) {
  const { videoId } = await params;
  const info = await getContestInfo(createAdminClient(), videoId);
  if (!info) {
    return (
      <>
        <h1 className="text-2xl font-semibold tracking-tight">Nothing to contest</h1>
        <p className="text-zinc-600 dark:text-zinc-400">This link is not valid, or the video was not rejected.</p>
      </>
    );
  }
  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">Contest a rejection</h1>
      <section>
        <h2 className="mb-1 font-medium">Why the video was rejected</h2>
        {info.reasons.length ? (
          <ul className="list-disc pl-5 text-sm">
            {info.reasons.map((r, i) => (
              <li key={i}>{r}</li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-zinc-600 dark:text-zinc-400">No detailed reason is available.</p>
        )}
      </section>
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        If you think this is a mistake, tell us why. A person will read your message and decide.
      </p>
      <ContestForm videoId={info.videoId} />
    </>
  );
}
