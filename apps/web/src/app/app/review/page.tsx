import Link from "next/link";
import { dashboardContext } from "@/lib/dashboard";
import { listReviewQueue } from "@/lib/domain/videos";
import { submitReview } from "./actions";
import { badge, button, card, input, muted } from "@/components/ui";

export const metadata = { title: "Review · Quellix" };

type Reason = { message: string; effect: string };

export default async function ReviewPage() {
  const { db, orgId } = await dashboardContext();
  const items = await listReviewQueue(db, orgId);
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold tracking-tight">Review</h1>
      {items.length === 0 ? (
        <div className={card + " " + muted}>Nothing to review. Doubtful videos land here.</div>
      ) : (
        items.map(({ video, playbackUrl, filename }) => (
          <article key={video.id} className={card + " flex flex-col gap-3"}>
            <div className="flex flex-wrap items-center gap-2">
              <Link href={`/app/videos/${video.id}`} className="font-medium underline">
                {video.external_id ?? filename ?? video.id}
              </Link>
              <span className={badge("review")}>review</span>
            </div>
            <ul className="list-disc pl-5 text-sm">
              {((video.decision?.reasons ?? []) as Reason[]).map((r, i) => (
                <li key={i}>{r.message}</li>
              ))}
            </ul>
            {playbackUrl ? (
              <video controls preload="metadata" src={playbackUrl} className="max-h-80 w-full rounded bg-black" />
            ) : (
              <p className={"text-sm " + muted}>The file has been deleted, so there is nothing to play.</p>
            )}
            <form action={submitReview} className="flex flex-wrap items-center gap-2">
              <input type="hidden" name="video_id" value={video.id} />
              <input name="note" maxLength={2000} placeholder="Note (optional)" className={input + " !w-auto min-w-48 flex-1"} />
              <button name="decision" value="accept" className={button("primary")}>
                Accept
              </button>
              <button name="decision" value="reject" className={button("danger")}>
                Reject
              </button>
            </form>
          </article>
        ))
      )}
    </div>
  );
}
