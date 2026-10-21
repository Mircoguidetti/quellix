import { CircleCheck, CircleDot, CircleX, Clock3 } from "lucide-react";
import { Badge, toneFor } from "@/components/ui/badge";

const ICONS = { accept: CircleCheck, reject: CircleX, review: CircleDot } as const;

/** accept / reject / review with the landing's status colours and an icon (not colour alone). */
export function DecisionBadge({ value, className }: { value: string | null | undefined; className?: string }) {
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
