import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { FlaskConical, Plus } from "lucide-react";
import { EmptyState } from "@/components/app/empty-state";
import { PageContainer, PageHeader } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { dashboardContext } from "@/lib/dashboard";
import { listPilots } from "@/lib/domain/pilots";
import { pilotsEnabled } from "@/lib/pilots/flag";
import { formatDate } from "@/lib/format";

export const metadata: Metadata = { title: "Pilots" };

const DESCRIPTION =
  "Shadow mode: send videos your reviewers already judged, with success criteria agreed up front. Ormes runs alongside without webhooks or contributor feedback, and reports pass or fail.";

export default function PilotsPage() {
  return (
    <PageContainer>
      <Suspense fallback={<Skeleton className="h-80 rounded-xl" />}>
        <Content />
      </Suspense>
    </PageContainer>
  );
}

async function Content() {
  if (!pilotsEnabled()) notFound();
  const { db, orgId, session } = await dashboardContext();
  const pilots = await listPilots(db, orgId);
  const canStart = session.role !== "reviewer";
  const action = canStart ? (
    <Button asChild>
      <Link href="/app/pilots/new">
        <Plus aria-hidden />
        New pilot
      </Link>
    </Button>
  ) : undefined;

  return (
    <>
      <PageHeader title="Pilots" description={DESCRIPTION} actions={action} />
      {pilots.length === 0 ? (
        <EmptyState icon={FlaskConical} title="No pilots yet" description="Import a batch your reviewers already judged and compare Ormes with them, before you change anything in your pipeline." action={action} />
      ) : (
        <div className="overflow-hidden rounded-xl border border-border">
          <Table>
            <TableHeader className="bg-subtle">
              <TableRow>
                <TableHead>Pilot</TableHead>
                <TableHead className="hidden sm:table-cell">Rubric</TableHead>
                <TableHead className="text-right">Analysed</TableHead>
                <TableHead className="hidden text-right md:table-cell">Started</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pilots.map((p) => (
                <TableRow key={p.id} className="relative hover:bg-subtle focus-within:bg-subtle">
                  <TableCell className="whitespace-normal">
                    <Link
                      href={`/app/pilots/${p.id}`}
                      className="font-medium outline-none after:absolute after:inset-0 focus-visible:after:ring-2 focus-visible:after:ring-inset focus-visible:after:ring-ring"
                    >
                      {p.name}
                    </Link>
                    <span className="block text-[12.5px] text-muted-foreground sm:hidden">
                      {p.rubric_name} v{p.rubric_version}
                    </span>
                  </TableCell>
                  <TableCell className="hidden text-muted-foreground sm:table-cell">
                    {p.rubric_name} v{p.rubric_version}
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    {p.decided} / {p.videos}
                  </TableCell>
                  <TableCell className="hidden text-right font-mono text-[12.5px] text-muted-foreground md:table-cell">{formatDate(p.created_at)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </>
  );
}
