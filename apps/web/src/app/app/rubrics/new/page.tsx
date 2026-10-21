import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import example from "@quellix/contracts/examples/rubric.load_dishwasher.json";
import { PageContainer, PageHeader } from "@/components/app/page-header";
import { dashboardContext } from "@/lib/dashboard";
import { recentDecisionChecks } from "@/lib/domain/rubrics";
import { EditorSkeleton } from "../editor-skeleton";
import { RubricEditor } from "../rubric-editor";

export const metadata: Metadata = { title: "New rubric" };

export default function NewRubricPage() {
  return (
    <PageContainer>
      <PageHeader
        eyebrow={
          <Link href="/app/rubrics" className="inline-flex items-center gap-1.5 rounded hover:text-foreground">
            <ArrowLeft className="size-3.5" aria-hidden />
            Rubrics
          </Link>
        }
        title="New rubric"
        description="Starts from the dishwasher example. Change every field to match your lab's spec."
      />
      <Suspense fallback={<EditorSkeleton />}>
        <Content />
      </Suspense>
    </PageContainer>
  );
}

async function Content() {
  const { db, orgId, session } = await dashboardContext();
  const { scope, rows } = await recentDecisionChecks(db, orgId, null);
  const { name, task, checks } = example;
  return (
    <RubricEditor
      rubricId={null}
      currentVersion={null}
      initial={{ name: name.replace(" (example)", ""), task, checks }}
      history={[]}
      samples={rows}
      sampleScope={scope}
      canEdit={session.role !== "reviewer"}
    />
  );
}
