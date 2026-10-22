import { Suspense } from "react";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthShell } from "@/components/auth/auth-shell";
import { AuthFormSkeleton } from "@/components/auth/auth-skeleton";
import { getCurrentUser } from "@/lib/auth/server";
import { listMemberships } from "@/lib/session";
import { OnboardingForm } from "./onboarding-form";

export const metadata: Metadata = { title: "Create your organization" };

export default function OnboardingPage({ searchParams }: PageProps<"/onboarding">) {
  return (
    <AuthShell>
      <div className="w-full max-w-[440px]">
        <Suspense
          fallback={
            <div className="rounded-2xl border border-border bg-card p-7">
              <AuthFormSkeleton fields={1} extra={false} />
            </div>
          }
        >
          <Content searchParams={searchParams} />
        </Suspense>
      </div>
    </AuthShell>
  );
}

async function Content({ searchParams }: { searchParams: PageProps<"/onboarding">["searchParams"] }) {
  const sp = await searchParams;
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const additional = sp.new === "1";
  const memberships = await listMemberships(user.id);
  if (memberships.length && !additional) redirect("/app");
  const firstName = user.name?.split(" ")[0];
  return <OnboardingForm additional={additional} greeting={firstName ? `Welcome, ${firstName}` : "Welcome to Ormes"} />;
}
