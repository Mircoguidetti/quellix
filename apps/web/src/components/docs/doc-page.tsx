import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowLeft, ArrowRight, ChevronRight } from "lucide-react";
import { docNeighbours, docPage } from "./nav";
import { OnThisPage, type TocItem } from "./on-this-page";

/** One docs page: breadcrumb, title, lead, body, Previous / Next, and "On this page" when long. */
export function DocPage({ href, title, lead, toc, children }: { href: string; title?: string; lead: ReactNode; toc?: TocItem[]; children: ReactNode }) {
  const page = docPage(href);
  const GroupIcon = page.group.icon;
  return (
    <div className="flex gap-12 px-0 pb-20 pt-8 lg:pl-12 lg:pt-12 xl:gap-16">
      <article className="min-w-0 max-w-[720px] flex-1">
        <p className="flex items-center gap-1.5 font-mono text-[12px] text-muted-foreground">
          <GroupIcon className="size-3.5" strokeWidth={1.5} aria-hidden />
          {page.group.label}
          {href !== "/docs" ? (
            <>
              <ChevronRight className="size-3" strokeWidth={1.5} aria-hidden />
              <span className="text-foreground/70">{page.title}</span>
            </>
          ) : null}
        </p>
        <h1 className="mt-3 text-[32px] font-semibold leading-[1.1] tracking-[-0.025em] sm:text-[38px]">{title ?? page.title}</h1>
        <div className="mt-4 max-w-[62ch] text-[17px] leading-[1.65] text-muted-foreground">{lead}</div>
        <div className="mt-10">{children}</div>
        <PrevNext href={href} />
      </article>
      {toc?.length ? (
        <aside className="hidden w-[200px] shrink-0 xl:block">
          <div className="sticky top-24">
            <OnThisPage items={toc} />
          </div>
        </aside>
      ) : null}
    </div>
  );
}

function PrevNext({ href }: { href: string }) {
  const { previous, next } = docNeighbours(href);
  return (
    <nav aria-label="Previous and next page" className="mt-16 grid gap-3 border-t border-border pt-8 sm:grid-cols-2">
      {previous ? (
        <Link href={previous.href} rel="prev" className="group rounded-xl border border-border px-4 py-3.5 transition-colors hover:border-foreground/25 hover:bg-subtle">
          <span className="flex items-center gap-1.5 text-[12.5px] text-muted-foreground">
            <ArrowLeft className="size-3.5 transition-transform group-hover:-translate-x-0.5" strokeWidth={1.5} aria-hidden />
            Previous
          </span>
          <span className="mt-1 block text-[15px] font-medium text-foreground">{previous.title}</span>
        </Link>
      ) : (
        <span className="hidden sm:block" />
      )}
      {next ? (
        <Link href={next.href} rel="next" className="group rounded-xl border border-border px-4 py-3.5 text-right transition-colors hover:border-foreground/25 hover:bg-subtle">
          <span className="flex items-center justify-end gap-1.5 text-[12.5px] text-muted-foreground">
            Next
            <ArrowRight className="size-3.5 transition-transform group-hover:translate-x-0.5" strokeWidth={1.5} aria-hidden />
          </span>
          <span className="mt-1 block text-[15px] font-medium text-foreground">{next.title}</span>
        </Link>
      ) : null}
    </nav>
  );
}
