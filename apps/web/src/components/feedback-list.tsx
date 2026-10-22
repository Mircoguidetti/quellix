import { CircleX, Clock, Lightbulb } from "lucide-react";
import { formatSegments, type FeedbackItem } from "@/lib/feedback";

/** Contributor feedback as shown on the public contest page and in the contest review. */
export function FeedbackList({ items, size = "lg" }: { items: FeedbackItem[]; size?: "lg" | "sm" }) {
  const text = size === "lg" ? "text-[15.5px]" : "text-[14px]";
  return (
    <ul className="grid gap-3.5">
      {items.map((item, i) => (
        <li key={`${item.code ?? "generic"}-${i}`} className="flex items-start gap-3">
          <CircleX className="mt-0.5 size-[18px] shrink-0 text-reject-fg" aria-hidden />
          <div className="grid min-w-0 gap-1">
            <p className={`${text} leading-snug`}>{item.message}</p>
            {item.hint && (
              <p className="flex items-start gap-1.5 text-[14px] leading-snug text-foreground/85">
                <Lightbulb className="mt-0.5 size-3.5 shrink-0 text-brand" aria-hidden />
                <span>
                  <span className="sr-only">How to fix: </span>
                  {item.hint}
                </span>
              </p>
            )}
            {item.segments.length > 0 && (
              <p className="flex items-center gap-1.5 font-mono text-[12.5px] tabular-nums text-muted-foreground">
                <Clock className="size-3.5 shrink-0" aria-hidden />
                <span className="sr-only">When: </span>
                {formatSegments(item.segments)}
              </p>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}
