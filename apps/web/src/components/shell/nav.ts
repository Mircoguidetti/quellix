import { ClipboardList, Film, FlaskConical, Inbox, LayoutDashboard, ListChecks, Scale, Settings, type LucideIcon } from "lucide-react";

/** `flag`: shown only when that feature is on (pilots need their migration, issue #65). */
export type NavItem = { href: string; label: string; icon: LucideIcon; badge?: "review"; flag?: "pilots" };

export const NAV: NavItem[] = [
  { href: "/app", label: "Overview", icon: LayoutDashboard },
  { href: "/app/review", label: "Review", icon: Inbox, badge: "review" },
  { href: "/app/videos", label: "Videos", icon: Film },
  { href: "/app/rubrics", label: "Rubrics", icon: ListChecks },
  { href: "/app/contests", label: "Contests", icon: Scale },
  { href: "/app/audit", label: "Audit", icon: ClipboardList },
  { href: "/app/pilots", label: "Pilots", icon: FlaskConical, flag: "pilots" },
  { href: "/app/settings", label: "Settings", icon: Settings },
];

export function isActive(pathname: string, href: string): boolean {
  return href === "/app" ? pathname === "/app" : pathname === href || pathname.startsWith(`${href}/`);
}
