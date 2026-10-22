import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";

/** Shared building blocks of the marketing pages. Visuals live in each page's own folder. */

export const ICON = { strokeWidth: 1.5, "aria-hidden": true } as const;

export function Wrap({ className, children }: { className?: string; children: React.ReactNode }) {
  return <div className={cn("mx-auto w-full max-w-[1160px] px-4 sm:px-6", className)}>{children}</div>;
}

export function Section({
  id,
  className,
  children,
  label,
}: {
  id: string;
  className?: string;
  children: React.ReactNode;
  /** Accessible name of the section when its heading is not enough. */
  label?: string;
}) {
  return (
    <section id={id} aria-label={label} className={cn("scroll-mt-28 py-20 sm:py-28", className)}>
      <Wrap>{children}</Wrap>
    </section>
  );
}

export function H2({ children, className, id }: { children: React.ReactNode; className?: string; id?: string }) {
  return (
    <h2 id={id} className={cn("max-w-[22ch] text-balance text-[clamp(30px,4.2vw,48px)] font-medium leading-[1.05] tracking-[-0.03em]", className)}>
      {children}
    </h2>
  );
}

export function Lead({ children, className }: { children: React.ReactNode; className?: string }) {
  return <p className={cn("mt-5 max-w-[60ch] text-pretty text-[17px] leading-relaxed text-muted-foreground", className)}>{children}</p>;
}

/** Small tag for features that are not built yet. */
export function Soon({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border border-brand/30 bg-brand/10 px-2 py-px align-middle text-[11.5px] font-medium text-brand",
        className,
      )}
    >
      Soon
    </span>
  );
}

/** Marks numbers that are illustrative, not measured. */
export function Example({ className, children = "Example" }: { className?: string; children?: React.ReactNode }) {
  return (
    <span className={cn("inline-flex shrink-0 items-center whitespace-nowrap rounded border border-hairline px-1.5 text-[12px] text-muted-foreground", className)}>
      {children}
    </span>
  );
}

export function MoreLink({ href, children, className }: { href: string; children: React.ReactNode; className?: string }) {
  return (
    <Link href={href} className={cn("group inline-flex items-center gap-1.5 text-[15px] font-medium text-brand", className)}>
      {children}
      <ArrowRight {...ICON} className="size-4 transition-transform duration-200 group-hover:translate-x-0.5" />
    </Link>
  );
}

export function ButtonLink({
  href,
  children,
  variant = "solid",
  className,
}: {
  href: string;
  children: React.ReactNode;
  variant?: "solid" | "outline";
  className?: string;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "inline-flex h-11 items-center justify-center gap-2 rounded-full px-5 text-[15px] font-medium transition-colors",
        variant === "solid" ? "bg-white text-black hover:bg-white/85" : "border border-white/20 text-foreground hover:border-white/45 hover:bg-white/5",
        className,
      )}
    >
      {children}
    </Link>
  );
}

/**
 * Compact page header for every page but Home: a title, one line of intro and the in-page nav.
 * The nav sticks under the site header so each section stays one tap away.
 */
export function PageIntro({
  title,
  intro,
  nav,
}: {
  title: string;
  intro: string;
  nav: { href: string; label: string; icon: LucideIcon }[];
}) {
  return (
    <>
      <Wrap className="pb-8 pt-14 sm:pt-20">
        <h1 className="text-balance text-[clamp(36px,5.4vw,60px)] font-medium leading-[1.02] tracking-[-0.035em]">{title}</h1>
        <p className="mt-4 max-w-[62ch] text-pretty text-[17px] leading-relaxed text-muted-foreground">{intro}</p>
      </Wrap>
      <nav aria-label="On this page" className="sticky top-16 z-40 border-y border-hairline bg-black/80 backdrop-blur-md">
        <Wrap>
          <ul className="-mx-1 flex gap-1 overflow-x-auto py-2 [scrollbar-width:none]">
            {nav.map(({ href, label, icon: Icon }) => (
              <li key={href} className="shrink-0">
                <a
                  href={href}
                  className="inline-flex h-9 items-center gap-2 rounded-full px-3 text-[14px] text-muted-foreground transition-colors hover:bg-white/5 hover:text-foreground"
                >
                  <Icon {...ICON} className="size-4" />
                  {label}
                </a>
              </li>
            ))}
          </ul>
        </Wrap>
      </nav>
    </>
  );
}
