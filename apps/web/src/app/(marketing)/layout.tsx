import { SiteFooter } from "@/components/site/site-footer";
import { SiteNav } from "@/components/site/site-nav";

/** The public marketing pages (Home, Product, Security): dark, with the shared header and footer. */
export default function MarketingLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="dark min-h-dvh overflow-x-clip bg-black text-foreground antialiased" data-marketing="">
      <SiteNav />
      {children}
      <SiteFooter />
    </div>
  );
}
