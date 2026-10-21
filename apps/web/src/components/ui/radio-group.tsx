"use client";

import { RadioGroup as RadioGroupPrimitive } from "radix-ui";
import { cn } from "@/lib/utils";

export function RadioGroup({ className, ...props }: React.ComponentProps<typeof RadioGroupPrimitive.Root>) {
  return <RadioGroupPrimitive.Root className={cn("grid gap-2", className)} {...props} />;
}

/** A selectable card: title, description, and a radio dot. */
export function RadioCard({
  className,
  title,
  description,
  ...props
}: React.ComponentProps<typeof RadioGroupPrimitive.Item> & { title: string; description?: string }) {
  return (
    <RadioGroupPrimitive.Item
      className={cn(
        "group flex w-full items-start gap-3 rounded-xl border border-border p-3.5 text-left outline-none transition-colors hover:bg-subtle focus-visible:ring-2 focus-visible:ring-ring data-[state=checked]:border-foreground data-[state=checked]:bg-subtle",
        className,
      )}
      {...props}
    >
      <span className="mt-0.5 grid size-4 shrink-0 place-items-center rounded-full border border-input group-data-[state=checked]:border-foreground">
        <RadioGroupPrimitive.Indicator className="size-2 rounded-full bg-foreground" />
      </span>
      <span className="flex flex-col gap-0.5">
        <span className="text-sm font-medium">{title}</span>
        {description && <span className="text-[13px] leading-snug text-muted-foreground">{description}</span>}
      </span>
    </RadioGroupPrimitive.Item>
  );
}
