import { CircleCheck, CircleDot, CircleX, Clock3, TriangleAlert } from "lucide-react";
import { Badge, toneFor } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

const ICONS = { accept: CircleCheck, reject: CircleX, review: CircleDot } as const;

/**
 * accept / reject / review with the landing's status colours and an icon (not colour alone).
 * Without a decision: `failed` (with the error on hover or focus) when processing failed, else
 * `pending`.
 */
export function DecisionBadge({
  value,
  status,
  error,
  className,
}: {
  value: string | null | undefined;
  status?: string;
  error?: string | null;
  className?: string;
}) {
  if (!value && status === "failed") {
    const badge = (
      <Badge tone="outline" className={`border-reject-fg/40 text-reject-fg ${className ?? ""}`}>
        <TriangleAlert aria-hidden />
        failed
      </Badge>
    );
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span tabIndex={0} className="relative z-10 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label={`Failed: ${error ?? "no error was recorded"}`}>
            {badge}
          </span>
        </TooltipTrigger>
        <TooltipContent>{error ? `Last attempt: ${error}` : "Processing failed. No error was recorded."}</TooltipContent>
      </Tooltip>
    );
  }
  if (!value) {
    return (
      <Badge tone="outline" className={className}>
        <Clock3 aria-hidden />
        pending
      </Badge>
    );
  }
  const Icon = ICONS[value as keyof typeof ICONS] ?? CircleDot;
  return (
    <Badge tone={toneFor(value)} className={className}>
      <Icon aria-hidden />
      {value}
    </Badge>
  );
}
