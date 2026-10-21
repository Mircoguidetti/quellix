import Link from "next/link";
import { dashboardContext } from "@/lib/dashboard";
import { listRubrics } from "@/lib/domain/rubrics";
import { button, card, muted } from "@/components/ui";

export const metadata = { title: "Rubrics · Quellix" };

export default async function RubricsPage() {
  const { db, orgId } = await dashboardContext();
  const rubrics = await listRubrics(db, orgId);
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold tracking-tight">Rubrics</h1>
        <Link href="/app/rubrics/new" className={button("primary")}>
          New rubric
        </Link>
      </div>
      {rubrics.length === 0 ? (
        <div className={card + " " + muted}>No rubrics yet. A rubric is the lab&apos;s spec for one task.</div>
      ) : (
        <ul className="flex flex-col divide-y divide-zinc-200 rounded-lg border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
          {rubrics.map((r) => (
            <li key={r.id}>
              <Link href={`/app/rubrics/${r.id}`} className="flex items-center justify-between gap-4 px-4 py-3 text-sm hover:bg-zinc-50 dark:hover:bg-zinc-900">
                <span className="font-medium">{r.name}</span>
                <span className={muted}>v{r.version}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
