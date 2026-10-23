"use client";

import { useRef, useState, useTransition } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { toast } from "sonner";
import { BookOpen, Check, ChevronsUpDown, LogOut, Menu, PanelLeftClose, PanelLeftOpen, Plus, Settings } from "lucide-react";
import { Logo } from "@/components/logo";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { initials } from "@/lib/format";
import { cn } from "@/lib/utils";
import { setSidebarCollapsed, switchOrganization } from "./actions";
import { NAV, isActive } from "./nav";
import { formatCount, ReviewCountProvider, useReviewCount } from "./review-count";

export type ShellUser = { name: string | undefined; email: string | undefined };
export type ShellOrg = { orgId: string; orgName: string; role: string };

type Props = {
  user: ShellUser;
  org: ShellOrg;
  memberships: ShellOrg[];
  reviewCount: number;
  initialCollapsed: boolean;
  demo: boolean;
  /** Shadow pilots are enabled (issue #65). */
  pilots?: boolean;
  children: React.ReactNode;
};

export function AppShell({ user, org, memberships, reviewCount, initialCollapsed, demo, pilots = false, children }: Props) {
  const [collapsed, setCollapsed] = useState(initialCollapsed);
  const [mobileOpen, setMobileOpen] = useState(false);

  const toggle = () => {
    setCollapsed((c) => {
      void setSidebarCollapsed(!c);
      return !c;
    });
  };

  return (
    <ReviewCountProvider initial={reviewCount}>
      <div className="flex min-h-dvh bg-background">
        <a
          href="#main"
          className="sr-only z-[60] rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground focus:not-sr-only focus:fixed focus:left-3 focus:top-3"
        >
          Skip to content
        </a>

        {/* Desktop sidebar */}
        <aside
          className={cn(
            "dark hidden shrink-0 border-r border-border bg-background text-foreground transition-[width] duration-200 lg:block",
            collapsed ? "w-[68px]" : "w-[248px]",
          )}
          aria-label="Sidebar"
        >
          <div className="sticky top-0 h-dvh">
            <SidebarBody user={user} org={org} memberships={memberships} collapsed={collapsed} onToggle={toggle} demo={demo} pilots={pilots} />
          </div>
        </aside>

        {/* Mobile drawer */}
        <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
          <SheetContent side="left" className="dark border-r border-border bg-background text-foreground lg:hidden">
            <SheetTitle className="sr-only">Navigation</SheetTitle>
            <SheetDescription className="sr-only">Move between sections of Ormes</SheetDescription>
            <SidebarBody user={user} org={org} memberships={memberships} collapsed={false} onNavigate={() => setMobileOpen(false)} demo={demo} pilots={pilots} />
          </SheetContent>
        </Sheet>

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="dark sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-border bg-background px-3 text-foreground lg:hidden">
            <button
              type="button"
              onClick={() => setMobileOpen(true)}
              className="grid size-9 place-items-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"
              aria-label="Open navigation"
            >
              <Menu className="size-5" aria-hidden />
            </button>
            <Link href="/app" className="rounded-md" aria-label="Ormes overview">
              <Logo className="text-[14px]" />
            </Link>
            <span className="ml-auto max-w-[45%] truncate text-[13px] text-muted-foreground">{org.orgName}</span>
          </header>
          <main id="main" className="min-w-0 flex-1 outline-none" tabIndex={-1}>
            {children}
          </main>
        </div>
      </div>
    </ReviewCountProvider>
  );
}

function SidebarBody({
  user,
  org,
  memberships,
  collapsed,
  onToggle,
  onNavigate,
  demo,
  pilots,
}: {
  user: ShellUser;
  org: ShellOrg;
  memberships: ShellOrg[];
  collapsed: boolean;
  onToggle?: () => void;
  onNavigate?: () => void;
  demo: boolean;
  pilots: boolean;
}) {
  const pathname = usePathname();
  const { count } = useReviewCount();

  return (
    <div className="flex h-full flex-col">
      <div className={cn("flex h-14 items-center", collapsed ? "justify-center px-0" : "justify-between pl-4 pr-2")}>
        {!collapsed && (
          <Link href="/app" className="rounded-md" onClick={onNavigate} aria-label="Ormes overview">
            <Logo className="text-[14px]" />
          </Link>
        )}
        {onToggle && (
          <SideTooltip label={collapsed ? "Expand sidebar" : "Collapse sidebar"} show>
            <button
              type="button"
              onClick={onToggle}
              className="grid size-8 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
              aria-expanded={!collapsed}
            >
              {collapsed ? <PanelLeftOpen className="size-4" aria-hidden /> : <PanelLeftClose className="size-4" aria-hidden />}
            </button>
          </SideTooltip>
        )}
      </div>

      <div className={cn("px-3 pb-3", collapsed && "px-2")}>
        <OrgSwitcher org={org} memberships={memberships} collapsed={collapsed} />
      </div>

      <nav aria-label="Main" className={cn("flex flex-1 flex-col gap-0.5 overflow-y-auto px-3", collapsed && "px-2")}>
        {NAV.filter((item) => !item.flag || (item.flag === "pilots" && pilots)).map((item) => {
          const active = isActive(pathname, item.href);
          const Icon = item.icon;
          const badge = item.badge === "review" && count > 0 ? formatCount(count) : null;
          return (
            <SideTooltip key={item.href} label={badge ? `${item.label} · ${badge} waiting` : item.label} show={collapsed}>
              <Link
                href={item.href}
                onClick={onNavigate}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "group relative flex h-9 items-center gap-3 rounded-lg px-2.5 text-[14px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
                  active && "bg-muted text-foreground",
                  collapsed && "justify-center px-0",
                )}
              >
                <Icon className={cn("size-[18px] shrink-0", active ? "text-brand" : "")} strokeWidth={1.75} aria-hidden />
                {!collapsed && <span className="flex-1 truncate">{item.label}</span>}
                {badge && !collapsed && (
                  <span className="rounded-md bg-accent px-1.5 font-mono text-[11px] leading-5 text-accent-foreground tabular-nums" aria-label={`${badge} waiting for review`}>
                    {badge}
                  </span>
                )}
                {badge && collapsed && <span className="absolute right-1.5 top-1.5 size-2 rounded-full bg-brand" aria-hidden />}
              </Link>
            </SideTooltip>
          );
        })}
      </nav>

      {demo && !collapsed && (
        <p className="mx-3 mb-2 rounded-lg border border-border px-3 py-2 text-[12px] leading-snug text-muted-foreground">
          <span className="font-mono text-[11px] uppercase tracking-[0.08em] text-accent-foreground">Demo data</span>
          <br />
          Seeded locally. Nothing here is a real customer.
        </p>
      )}

      <div className={cn("border-t border-border p-3", collapsed && "px-2")}>
        <UserMenu user={user} collapsed={collapsed} />
      </div>
    </div>
  );
}

function SideTooltip({ label, show, children }: { label: string; show: boolean; children: React.ReactElement }) {
  if (!show) return children;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  );
}

function OrgAvatar({ name }: { name: string }) {
  return (
    <span className="grid size-7 shrink-0 place-items-center rounded-md bg-accent font-mono text-[12px] font-medium text-accent-foreground">
      {name.trim()[0]?.toUpperCase() ?? "?"}
    </span>
  );
}

function OrgSwitcher({ org, memberships, collapsed }: { org: ShellOrg; memberships: ShellOrg[]; collapsed: boolean }) {
  const [pending, start] = useTransition();
  const choose = (orgId: string) => {
    if (orgId === org.orgId) return;
    start(async () => {
      try {
        await switchOrganization(orgId);
      } catch (e) {
        if (typeof e === "object" && e && "digest" in e) throw e;
        toast.error("Could not switch organization. Try again.");
      }
    });
  };
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={cn(
          "flex w-full items-center gap-2.5 rounded-lg border border-border bg-card p-1.5 text-left outline-none transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring data-[state=open]:bg-muted",
          collapsed && "justify-center border-transparent bg-transparent p-1",
          pending && "opacity-60",
        )}
        aria-label={`Organization: ${org.orgName}. Switch organization`}
      >
        <OrgAvatar name={org.orgName} />
        {!collapsed && (
          <>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13.5px] font-medium">{org.orgName}</span>
              <span className="block font-mono text-[11px] capitalize text-muted-foreground">{org.role}</span>
            </span>
            <ChevronsUpDown className="mr-1 size-4 shrink-0 text-muted-foreground" aria-hidden />
          </>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent className="dark w-60" align="start" side={collapsed ? "right" : "bottom"}>
        <DropdownMenuLabel>Organizations</DropdownMenuLabel>
        {memberships.map((m) => (
          <DropdownMenuItem key={m.orgId} onSelect={() => choose(m.orgId)} className="pr-8">
            <OrgAvatar name={m.orgName} />
            <span className="min-w-0 flex-1 truncate">{m.orgName}</span>
            {m.orgId === org.orgId && <Check className="absolute right-2.5 !text-foreground" aria-label="Current" />}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/onboarding?new=1">
            <Plus aria-hidden />
            Add organization
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function UserMenu({ user, collapsed }: { user: ShellUser; collapsed: boolean }) {
  const label = user.name ?? user.email ?? "Account";
  const signOutForm = useRef<HTMLFormElement>(null);
  return (
    <>
    <form ref={signOutForm} action="/auth/signout" method="post" className="hidden" aria-hidden />
    <DropdownMenu>
      <DropdownMenuTrigger
        className={cn(
          "flex w-full items-center gap-2.5 rounded-lg p-1.5 text-left outline-none transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring data-[state=open]:bg-muted",
          collapsed && "justify-center",
        )}
        aria-label={`Account menu for ${label}`}
      >
        <span className="grid size-7 shrink-0 place-items-center rounded-full bg-[#2a2e34] text-[11.5px] font-medium text-foreground">
          {initials(user.name, user.email)}
        </span>
        {!collapsed && (
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13.5px] font-medium">{label}</span>
            {user.name && <span className="block truncate text-[12px] text-muted-foreground">{user.email}</span>}
          </span>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent className="dark w-60" align="start" side={collapsed ? "right" : "top"}>
        <DropdownMenuLabel className="normal-case tracking-normal">
          <span className="block truncate font-sans text-[13px] text-foreground">{label}</span>
          {user.name && <span className="block truncate font-sans text-[12px]">{user.email}</span>}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/app/settings">
            <Settings aria-hidden />
            Settings
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/data">
            <BookOpen aria-hidden />
            How we handle data
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => signOutForm.current?.requestSubmit()}>
          <LogOut aria-hidden />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
    </>
  );
}

