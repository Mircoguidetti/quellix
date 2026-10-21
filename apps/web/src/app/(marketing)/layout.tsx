import { SiteNav } from "@/components/marketing/site-nav";
import styles from "@/components/marketing/site.module.css";

/** The public marketing site (docs/design/site): dark, its own stylesheet, scoped to this group. */
export default function MarketingLayout({ children }: LayoutProps<"/">) {
  return (
    <div className={styles.site} data-marketing="">
      <SiteNav />
      {children}
    </div>
  );
}
