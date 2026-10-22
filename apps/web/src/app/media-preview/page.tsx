import type { Metadata } from "next";
import { ClipPreview } from "@/components/media/clip-preview";

// A working page for choosing the footage that goes on the site: not linked anywhere, not indexed.
export const metadata: Metadata = { title: "Media preview", robots: { index: false, follow: false } };

export default function MediaPreviewPage() {
  return (
    <main className="mx-auto grid max-w-6xl gap-6 px-4 py-10 sm:px-6">
      <header className="grid gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">Example footage, analysed by Ormes</h1>
        <p className="text-muted-foreground">
          The first-person footage chosen for the site. The first clip (the hero) also has its 9:16 mobile crop and
          two synthetic defective copies, with the worker&apos;s own decision, reasons and hints, unedited. Press play to see what the hands
          model saw in each frame.
        </p>
      </header>
      <ClipPreview />
    </main>
  );
}
