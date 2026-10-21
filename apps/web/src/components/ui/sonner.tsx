"use client";

import { Toaster as Sonner } from "sonner";

export function Toaster() {
  return (
    <Sonner
      position="bottom-right"
      closeButton
      toastOptions={{
        classNames: {
          toast:
            "!rounded-xl !border !border-border !bg-popover !text-popover-foreground !shadow-xl !shadow-black/15 !font-sans",
          description: "!text-muted-foreground",
          actionButton: "!rounded-md !bg-primary !text-primary-foreground !font-medium",
          cancelButton: "!rounded-md !bg-muted !text-foreground",
          closeButton: "!border-border !bg-popover !text-muted-foreground",
        },
      }}
    />
  );
}
