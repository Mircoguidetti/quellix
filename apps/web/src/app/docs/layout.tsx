import { DocsFooter } from "@/components/docs/footer";
import { DocsHeader } from "@/components/docs/header";
import { DocsSidebarNav } from "@/components/docs/sidebar";

/** The documentation: light theme, header, sticky sidebar from `lg`, page content, footer. */
export default function DocsLayout({ children }: LayoutProps<"/docs">) {
  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground" data-docs="">
      <a href="#docs-content" className="sr-only z-50 rounded-md bg-foreground px-3 py-2 text-background focus:not-sr-only focus:fixed focus:left-3 focus:top-3">
        Skip to content
      </a>
      <DocsHeader />
      <div className="mx-auto flex w-full max-w-[1440px] flex-1 px-4 sm:px-6 lg:px-8">
        <aside className="sticky top-14 hidden h-[calc(100vh-3.5rem)] w-[240px] shrink-0 overflow-y-auto border-r border-border py-10 pr-5 lg:block">
          <DocsSidebarNav />
        </aside>
        <main id="docs-content" className="min-w-0 flex-1">
          {children}
        </main>
      </div>
      <DocsFooter />
    </div>
  );
}
