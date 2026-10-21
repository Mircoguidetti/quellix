import { Suspense } from "react";
import type { Metadata } from "next";
import { PageContainer, PageHeader } from "@/components/app/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { dashboardContext } from "@/lib/dashboard";
import { SettingsTabs, type MemberView } from "./settings-tabs";

export const metadata: Metadata = { title: "Settings" };

export default function SettingsPage({ searchParams }: PageProps<"/app/settings">) {
  return (
    <PageContainer className="max-w-[1040px]">
      <PageHeader title="Settings" description="API access, where decisions are sent, who is on the team and how your data is handled." />
      <Suspense
        fallback={
          <div className="grid gap-6" aria-busy="true" aria-label="Loading settings">
            <Skeleton className="h-10 w-full max-w-md" />
            <Skeleton className="h-64 rounded-xl" />
          </div>
        }
      >
        <Content searchParams={searchParams} />
      </Suspense>
    </PageContainer>
  );
}

const TABS = ["api-keys", "webhooks", "team", "privacy"] as const;

async function Content({ searchParams }: { searchParams: PageProps<"/app/settings">["searchParams"] }) {
  const sp = await searchParams;
  const tab = TABS.find((t) => t === sp.tab) ?? "api-keys";
  const { db, orgId, session } = await dashboardContext();
  const [{ data: keys }, { data: hooks }, { data: org }, { data: memberRows }] = await Promise.all([
    db.from("api_keys").select("id, name, prefix, created_at, last_used_at, revoked_at").eq("org_id", orgId).order("created_at", { ascending: false }),
    db.from("webhooks").select("id, url, active, created_at").eq("org_id", orgId).order("created_at", { ascending: false }),
    db.from("organizations").select("allow_external_models, training_opt_in").eq("id", orgId).single(),
    db.from("members").select("user_id, role, created_at").eq("org_id", orgId).order("created_at"),
  ]);
  const members: MemberView[] = await Promise.all(
    (memberRows ?? []).map(async (m) => {
      const { data } = await db.auth.admin.getUserById(m.user_id as string).catch(() => ({ data: { user: null } }));
      const meta = data.user?.user_metadata as { full_name?: string } | undefined;
      return {
        userId: m.user_id as string,
        role: m.role as MemberView["role"],
        email: data.user?.email ?? null,
        name: meta?.full_name ?? null,
        joinedAt: m.created_at as string,
        pending: Boolean(data.user && !(data.user as { last_sign_in_at?: string | null }).last_sign_in_at && "invited_at" in data.user),
      };
    }),
  );

  return (
    <SettingsTabs
      initialTab={tab}
      canEdit={session.role !== "reviewer"}
      myRole={session.role}
      myUserId={session.userId}
      keys={keys ?? []}
      hooks={hooks ?? []}
      members={members}
      allowExternal={org?.allow_external_models === true}
      trainingOptIn={org?.training_opt_in === true}
    />
  );
}
