import Link from "next/link";
import { notFound } from "next/navigation";
import { ApiError } from "@/lib/api/errors";
import { dashboardContext } from "@/lib/dashboard";
import { getRubric, listRubricVersions } from "@/lib/domain/rubrics";
import { RubricEditor } from "../rubric-editor";
import { muted } from "@/components/ui";

export default async function EditRubricPage({ params }: PageProps<"/app/rubrics/[id]">) {
  const { id } = await params;
  const { db, orgId } = await dashboardContext();
  const rubric = await getRubric(db, orgId, id).catch((e) => {
    if (e instanceof ApiError && e.status === 404) notFound();
    throw e;
  });
  const versions = await listRubricVersions(db, orgId, id);
  const { name, task, checks } = rubric;
  return (
    <div className="flex flex-col gap-4">
      <div>
        <Link href="/app/rubrics" className={"text-sm underline " + muted}>
          All rubrics
        </Link>
        <h1 className="mt-1 text-xl font-semibold tracking-tight">
          {name} <span className={"text-base font-normal " + muted}>v{rubric.version}</span>
        </h1>
        <p className={"text-sm " + muted}>
          Saving creates version {rubric.version + 1}. Earlier versions are kept ({versions.length} so far); every decision
          records the version it used.
        </p>
      </div>
      <RubricEditor rubricId={id} initial={{ name, task, checks }} />
    </div>
  );
}
