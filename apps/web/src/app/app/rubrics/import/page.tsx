import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { PageContainer, PageHeader } from "@/components/app/page-header";
import { dashboardContext } from "@/lib/dashboard";
import { recentDecisionChecks } from "@/lib/domain/rubrics";
import { externalModelsConfigured, orgAllowsExternalModels } from "@/lib/spec-import";
import { EditorSkeleton } from "../editor-skeleton";
import { SpecImporter } from "./spec-importer";

export const metadata: Metadata = { title: "Import a spec" };

export default function ImportSpecPage() {
  return (
    <PageContainer>
      <PageHeader
        eyebrow={
          <Link href="/app/rubrics" className="inline-flex items-center gap-1.5 rounded hover:text-foreground">
            <ArrowLeft className="size-3.5" aria-hidden />
            Rubrics
          </Link>
        }
        title="Import a lab spec"
        description="Paste the lab's guidelines or pick a PDF. We draft a rubric where every value points at the line it came from; you review it and save."
      />
      <Suspense fallback={<EditorSkeleton />}>
        <Content />
      </Suspense>
    </PageContainer>
  );
}

async function Content() {
  const { db, orgId, session } = await dashboardContext();
  const [{ scope, rows }, orgAllows] = await Promise.all([recentDecisionChecks(db, orgId, null), orgAllowsExternalModels(db, orgId)]);
  const model = !externalModelsConfigured() ? "unavailable" : orgAllows ? "available" : "disabled";
  return <SpecImporter model={model} samples={rows} sampleScope={scope} canEdit={session.role !== "reviewer"} />;
}
