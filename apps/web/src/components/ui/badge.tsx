import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

export const badgeVariants = cva(
  "inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-md px-2 py-0.5 font-mono text-[11.5px] font-medium leading-5 tabular-nums [&_svg]:size-3",
  {
    variants: {
      tone: {
        neutral: "bg-muted text-foreground/80",
        accept: "bg-accept-bg text-accept-fg",
        reject: "bg-reject-bg text-reject-fg",
        review: "bg-review-bg text-review-fg",
        outline: "border border-border text-muted-foreground",
      },
    },
    defaultVariants: { tone: "neutral" },
  },
);

export type BadgeTone = NonNullable<VariantProps<typeof badgeVariants>["tone"]>;

export function Badge({ className, tone, ...props }: React.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return <span data-slot="badge" className={cn(badgeVariants({ tone }), className)} {...props} />;
}

/** Decision / status values to badge tones. */
export function toneFor(value: string | null | undefined): BadgeTone {
  switch (value) {
    case "accept":
    case "pass":
    case "overturned":
    case "active":
      return "accept";
    case "reject":
    case "fail":
    case "upheld":
    case "failed":
    case "revoked":
      return "reject";
    case "review":
    case "uncertain":
    case "error":
    case "open":
      return "review";
    default:
      return "neutral";
  }
}
