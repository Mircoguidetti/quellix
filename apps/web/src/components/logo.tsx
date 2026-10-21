import { cn } from "@/lib/utils";

/** The Quellix mark from the landing: a square inside a square, accent inner stroke. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <span aria-hidden className={cn("relative inline-block size-4 rounded-[3px] border-[1.5px] border-current", className)}>
      <span className="absolute inset-[3px] rounded-[1px] border-[1.5px] border-brand" />
    </span>
  );
}

export function Logo({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2.5 text-[15px] font-semibold tracking-[0.14em]", className)}>
      <LogoMark />
      QUELLIX
    </span>
  );
}
