import { SiteFooter } from "@/components/site/site-footer";
import { SiteNav } from "@/components/site/site-nav";

/** The public marketing pages (Home, Product, Security): light content with dark accents (issue #69). */
export default function MarketingLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="surface-light min-h-dvh overflow-x-clip antialiased" data-marketing="">
      <SiteNav />
      {children}
      <SiteFooter />
    </div>
  );
}
