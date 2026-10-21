import Link from "next/link";
import { notFound } from "next/navigation";
import { ApiError } from "@/lib/api/errors";
import { dashboardContext, explainStatus } from "@/lib/dashboard";
import { getVideo } from "@/lib/domain/videos";
import { saveLabOutcome } from "./actions";
import { badge, button, card, input, muted } from "@/components/ui";

type Check = { status: string; measurements?: Record<string, unknown>; model?: string };
type Reason = { check: string; code: string; message: string; effect: string };

export default async function VideoReport({ params }: PageProps<"/app/videos/[id]">) {
  const { id } = await params;
  const { db, orgId } = await dashboardContext();
  const video = await getVideo(db, orgId, id).catch((e) => {
    if (e instanceof ApiError && e.status === 404) notFound();
    throw e;
  });
  const decision = video.decision;
  const reasons = (decision?.reasons ?? []) as Reason[];
  const checks = Object.entries((decision?.checks ?? {}) as Record<string, Check>);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href="/app" className={"text-sm underline " + muted}>
          All videos
        </Link>
        <h1 className="mt-1 break-all text-xl font-semibold tracking-tight">{video.external_id ?? video.id}</h1>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
          <span className={badge("neutral")}>{explainStatus(video.status)}</span>
          {decision && <span className={badge(decision.decision)}>{decision.decision}</span>}
          <span className={muted}>
            Rubric{" "}
            <Link className="underline" href={`/app/rubrics/${video.rubric_id}`}>
              v{decision?.rubric.version ?? video.rubric_version}
            </Link>
          </span>
        </div>
      </div>

      <section className={card}>
        <h2 className="mb-2 font-medium">Why</h2>
        {!decision ? (
          <p className={muted}>No decision yet.</p>
        ) : reasons.length === 0 ? (
          <p className={muted}>Every enabled check passed.</p>
        ) : (
          <ul className="flex flex-col gap-2 text-sm">
            {reasons.map((r, i) => (
              <li key={i} className="flex flex-wrap items-baseline gap-2">
                <span className={badge(r.effect)}>{r.effect}</span>
                <span>{r.message}</span>
                <code className="text-xs text-zinc-500">{r.code}</code>
              </li>
            ))}
          </ul>
        )}
        {video.review && (
          <p className="mt-3 text-sm">
            Human review: <span className={badge(video.review.decision)}>{video.review.decision}</span>
            {video.review.note ? <span className={muted}> — {video.review.note}</span> : null}
          </p>
        )}
      </section>

      {checks.length > 0 && (
        <section className={card}>
          <h2 className="mb-2 font-medium">Checks and measurements</h2>
          <div className="flex flex-col divide-y divide-zinc-200 dark:divide-zinc-800">
            {checks.map(([name, c]) => (
              <details key={name} className="py-2 text-sm" open={c.status === "fail" || c.status === "uncertain"}>
                <summary className="flex cursor-pointer flex-wrap items-center gap-2">
                  <span className="font-medium">{name.replaceAll("_", " ")}</span>
                  <span className={badge(statusTone(c.status))}>{c.status}</span>
                  {c.model && <span className="text-xs text-zinc-500">{c.model}</span>}
                </summary>
                <pre className="mt-2 overflow-x-auto rounded bg-zinc-100 p-3 text-xs dark:bg-zinc-900">
                  {JSON.stringify(c.measurements ?? {}, null, 2)}
                </pre>
              </details>
            ))}
          </div>
          {decision && <p className="mt-2 text-xs text-zinc-500">Engine {decision.engine_version}</p>}
        </section>
      )}

      <section className={card}>
        <h2 className="mb-2 font-medium">Lab outcome</h2>
        <p className={"mb-3 text-sm " + muted}>
          What the lab decided about this video. Used to measure rejection precision and recall.
        </p>
        <form action={saveLabOutcome} className="flex flex-col gap-3 sm:max-w-md">
          <input type="hidden" name="video_id" value={video.id} />
          <select name="outcome" defaultValue={video.lab_outcome?.outcome ?? "accept"} className={input}>
            <option value="accept">Lab accepted</option>
            <option value="reject">Lab rejected</option>
          </select>
          <input
            name="reason"
            maxLength={2000}
            placeholder="Reason (optional)"
            defaultValue={video.lab_outcome?.reason ?? ""}
            className={input}
          />
          <button className={button("secondary") + " self-start"}>Save lab outcome</button>
        </form>
      </section>
    </div>
  );
}

function statusTone(status: string) {
  return status === "pass" ? "accept" : status === "fail" ? "reject" : status === "uncertain" || status === "error" ? "review" : "neutral";
}
