import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: {
  icon: LucideIcon;
  title: string;
  description: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border px-6 py-14 text-center", className)}>
      <span className="grid size-11 place-items-center rounded-xl border border-border bg-subtle text-muted-foreground">
        <Icon className="size-5" strokeWidth={1.75} aria-hidden />
      </span>
      <div className="grid gap-1">
        <h2 className="text-[15px] font-medium">{title}</h2>
        <p className="max-w-[46ch] text-[14px] text-muted-foreground">{description}</p>
      </div>
      {action && <div className="mt-1">{action}</div>}
    </div>
  );
}
