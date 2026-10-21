"use client";

import { RotateCcw, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";

export function ErrorState({ title, description, onRetry }: { title: string; description: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="mx-auto flex max-w-md flex-col items-center gap-3 rounded-xl border border-border px-6 py-14 text-center">
      <span className="grid size-11 place-items-center rounded-xl bg-reject-bg text-reject-fg">
        <TriangleAlert className="size-5" aria-hidden />
      </span>
      <h2 className="text-[15px] font-medium">{title}</h2>
      <p className="text-[14px] text-muted-foreground">{description}</p>
      {onRetry && (
        <Button variant="secondary" onClick={onRetry} className="mt-1">
          <RotateCcw aria-hidden />
          Try again
        </Button>
      )}
    </div>
  );
}
