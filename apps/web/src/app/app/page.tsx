import Link from "next/link";
import { dashboardContext, explainStatus } from "@/lib/dashboard";
import { listVideos } from "@/lib/domain/videos";
import { listVideosQuerySchema } from "@/lib/api/schemas";
import { badge, card, input, button, muted } from "@/components/ui";

export const metadata = { title: "Videos · Quellix" };

export default async function VideosPage({ searchParams }: PageProps<"/app">) {
  const raw = await searchParams;
  const parsed = listVideosQuerySchema.safeParse({
    status: first(raw.status) || undefined,
    decision: first(raw.decision) || undefined,
    cursor: first(raw.cursor) || undefined,
    limit: 25,
  });
  const filters = parsed.success ? parsed.data : { limit: 25 };
  const { db, orgId } = await dashboardContext();
  const { data, next_cursor } = await listVideos(db, orgId, filters);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-xl font-semibold tracking-tight">Videos</h1>
        <form className="flex flex-wrap items-center gap-2 text-sm">
          <select name="status" defaultValue={filters.status ?? ""} className={input + " !w-auto"}>
            <option value="">Any status</option>
            {["awaiting_upload", "queued", "processing", "decided", "failed", "deleted"].map((s) => (
              <option key={s} value={s}>
                {explainStatus(s)}
              </option>
            ))}
          </select>
          <select name="decision" defaultValue={filters.decision ?? ""} className={input + " !w-auto"}>
            <option value="">Any decision</option>
            <option value="accept">Accept</option>
            <option value="reject">Reject</option>
            <option value="review">Review</option>
          </select>
          <button className={button("secondary")}>Filter</button>
        </form>
      </div>

      {data.length === 0 ? (
        <div className={card + " " + muted}>
          No videos yet. <Link className="underline" href="/app/upload">Upload one</Link> or use the API.
        </div>
      ) : (
        <ul className="flex flex-col divide-y divide-zinc-200 rounded-lg border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
          {data.map((v) => (
            <li key={v.id}>
              <Link
                href={`/app/videos/${v.id}`}
                className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 text-sm hover:bg-zinc-50 dark:hover:bg-zinc-900"
              >
                <span className="min-w-0 flex-1 truncate font-medium">{v.external_id ?? v.id}</span>
                <span className={badge("neutral")}>{explainStatus(v.status)}</span>
                {v.decision && <span className={badge(v.decision.decision)}>{v.decision.decision}</span>}
                {v.review && <span className={badge("neutral")}>reviewed: {v.review.decision}</span>}
                <time className="text-xs text-zinc-500" dateTime={v.created_at}>
                  {new Date(v.created_at).toISOString().slice(0, 16).replace("T", " ")}
                </time>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {next_cursor && (
        <Link
          className={button("secondary") + " self-start"}
          href={{
            pathname: "/app",
            query: {
              ...(filters.status ? { status: filters.status } : {}),
              ...(filters.decision ? { decision: filters.decision } : {}),
              cursor: next_cursor,
            },
          }}
        >
          Older videos
        </Link>
      )}
    </div>
  );
}

function first(v: string | string[] | undefined) {
  return Array.isArray(v) ? v[0] : v;
}
