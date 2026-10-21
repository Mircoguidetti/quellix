import Link from "next/link";
import { dashboardContext } from "@/lib/dashboard";
import { listRubrics } from "@/lib/domain/rubrics";
import { UploadForm } from "./upload-form";
import { card, muted } from "@/components/ui";

export const metadata = { title: "Upload · Quellix" };

export default async function UploadPage() {
  const { db, orgId } = await dashboardContext();
  const rubrics = (await listRubrics(db, orgId)).map((r) => ({ id: r.id, name: r.name, version: r.version }));
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold tracking-tight">Upload videos</h1>
      {rubrics.length === 0 ? (
        <div className={card + " " + muted}>
          Create a rubric first: <Link className="underline" href="/app/rubrics/new">new rubric</Link>.
        </div>
      ) : (
        <UploadForm rubrics={rubrics} />
      )}
    </div>
  );
}
