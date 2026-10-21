import { Suspense } from "react";
import type { Metadata } from "next";
import { AuthCard, AuthShell } from "@/components/auth/auth-shell";
import { AuthFormSkeleton, NotConfigured } from "@/components/auth/auth-skeleton";
import { ForgotForm } from "@/components/auth/forgot-form";
import { authConfigured } from "@/lib/auth/server";
import { callbackErrorMessage } from "@/lib/auth/callback-errors";

export const metadata: Metadata = { title: "Reset your password" };

export default function ForgotPasswordPage({ searchParams }: PageProps<"/forgot-password">) {
  return (
    <AuthShell>
      <AuthCard title="Reset your password" description="We will email you a link to choose a new one.">
        <Suspense fallback={<AuthFormSkeleton fields={1} extra={false} />}>
          <Content searchParams={searchParams} />
        </Suspense>
      </AuthCard>
    </AuthShell>
  );
}

async function Content({ searchParams }: { searchParams: PageProps<"/forgot-password">["searchParams"] }) {
  const sp = await searchParams;
  if (!authConfigured()) return <NotConfigured />;
  return <ForgotForm initialError={callbackErrorMessage(typeof sp.error === "string" ? sp.error : null)} />;
}
