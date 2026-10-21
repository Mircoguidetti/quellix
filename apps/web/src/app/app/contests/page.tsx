import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { Scale } from "lucide-react";
import { EmptyState } from "@/components/app/empty-state";
import { PageContainer, PageHeader } from "@/components/app/page-header";
import { Badge, toneFor } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { dashboardContext } from "@/lib/dashboard";
import { listContests } from "@/lib/domain/contests";
import { formatAge } from "@/lib/format";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Contests" };

export default function ContestsPage({ searchParams }: PageProps<"/app/contests">) {
  return (
    <PageContainer>
      <PageHeader
        title="Contests"
        description="Contributors can contest a rejection from the link you send them. A person on your team reads each one and decides."
      />
      <Suspense fallback={<Skeleton className="h-80 rounded-xl" />}>
        <Content searchParams={searchParams} />
      </Suspense>
    </PageContainer>
  );
}

const STATUS_LABEL = { open: "open", upheld: "rejection upheld", overturned: "overturned" } as const;

async function Content({ searchParams }: { searchParams: PageProps<"/app/contests">["searchParams"] }) {
  const sp = await searchParams;
  const view = sp.view === "resolved" ? "resolved" : "open";
  const { db, orgId } = await dashboardContext();
  const all = await listContests(db, orgId);
  const open = all.filter((c) => c.status === "open");
  const resolved = all.filter((c) => c.status !== "open");
  const rows = view === "open" ? open : resolved;

  return (
    <div className="grid gap-4">
      <nav aria-label="Contest status" className="flex gap-1 border-b border-border">
        {(
          [
            ["open", "Open", open.length],
            ["resolved", "Resolved", resolved.length],
          ] as const
        ).map(([key, label, n]) => (
          <Link
            key={key}
            href={key === "open" ? "/app/contests" : "/app/contests?view=resolved"}
            aria-current={view === key ? "page" : undefined}
            className={cn(
              "-mb-px inline-flex h-10 items-center gap-2 rounded-t-md border-b-2 border-transparent px-3 text-sm font-medium text-muted-foreground hover:text-foreground",
              view === key && "border-foreground text-foreground",
            )}
          >
            {label}
            <span className="rounded-md bg-muted px-1.5 font-mono text-[11px] leading-5 tabular-nums">{n}</span>
          </Link>
        ))}
      </nav>
      {rows.length === 0 ? (
        <EmptyState
          icon={Scale}
          title={view === "open" ? "No open contests" : "Nothing resolved yet"}
          description={
            view === "open"
              ? "When a contributor disagrees with a rejection, their message lands here for a person to decide."
              : "Resolved contests stay here with the decision and the note you wrote."
          }
        />
      ) : (
        <div className="overflow-hidden rounded-xl border border-border">
          <Table>
            <TableHeader className="bg-subtle">
              <TableRow>
                <TableHead>Contributor</TableHead>
                <TableHead className="hidden md:table-cell">Message</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="hidden text-right sm:table-cell">Received</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((c) => (
                <TableRow key={c.id} className="relative hover:bg-subtle focus-within:bg-subtle">
                  <TableCell>
                    <Link
                      href={`/app/contests/${c.id}`}
                      className="font-mono text-[13px] font-medium outline-none after:absolute after:inset-0 focus-visible:after:ring-2 focus-visible:after:ring-inset focus-visible:after:ring-ring"
                    >
                      {c.contributor_ref ?? "Unknown"}
                    </Link>
                    <span className="block max-w-[14rem] truncate text-[12.5px] text-muted-foreground md:hidden">{c.message}</span>
                  </TableCell>
                  <TableCell className="hidden max-w-[32rem] truncate whitespace-nowrap text-[13.5px] text-muted-foreground md:table-cell">{c.message}</TableCell>
                  <TableCell>
                    <Badge tone={toneFor(c.status)}>{STATUS_LABEL[c.status]}</Badge>
                  </TableCell>
                  <TableCell className="hidden text-right font-mono text-[12.5px] text-muted-foreground sm:table-cell">{formatAge(c.created_at)} ago</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
