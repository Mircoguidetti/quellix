import Link from "next/link";
import { dashboardContext } from "@/lib/dashboard";
import { listContests } from "@/lib/domain/contests";
import { resolveContestAction } from "./actions";
import { badge, button, card, input, muted } from "@/components/ui";

export const metadata = { title: "Contests · Quellix" };

export default async function ContestsPage() {
  const { db, orgId } = await dashboardContext();
  const contests = await listContests(db, orgId);
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold tracking-tight">Contests</h1>
      <p className={"text-sm " + muted}>
        Contributors contest a rejection from <code>/contest/&lt;video id&gt;</code>. A person resolves each one.
      </p>
      {contests.length === 0 ? (
        <div className={card + " " + muted}>No contests.</div>
      ) : (
        contests.map((c) => (
          <article key={c.id} className={card + " flex flex-col gap-2 text-sm"}>
            <div className="flex flex-wrap items-center gap-2">
              <Link className="font-medium underline" href={`/app/videos/${c.video_id}`}>
                Video {c.video_id.slice(0, 8)}
              </Link>
              <span className={badge(c.status === "open" ? "review" : c.status === "overturned" ? "accept" : "reject")}>{c.status}</span>
              {c.contributor_ref && <span className={muted}>contributor {c.contributor_ref}</span>}
              <time className="text-xs text-zinc-500" dateTime={c.created_at}>
                {c.created_at.slice(0, 16).replace("T", " ")}
              </time>
            </div>
            <p className="whitespace-pre-wrap">{c.message}</p>
            {c.status === "open" ? (
              <form action={resolveContestAction} className="flex flex-wrap items-center gap-2">
                <input type="hidden" name="id" value={c.id} />
                <input name="note" maxLength={2000} placeholder="Resolution note (optional)" className={input + " !w-auto min-w-48 flex-1"} />
                <button name="status" value="upheld" className={button("secondary")}>
                  Uphold rejection
                </button>
                <button name="status" value="overturned" className={button("primary")}>
                  Overturn
                </button>
              </form>
            ) : (
              c.resolution_note && <p className={muted}>Resolution: {c.resolution_note}</p>
            )}
          </article>
        ))
      )}
    </div>
  );
}
