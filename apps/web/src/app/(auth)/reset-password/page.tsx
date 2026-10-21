import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { AuthCard, AuthShell } from "@/components/auth/auth-shell";
import { AuthFormSkeleton, NotConfigured } from "@/components/auth/auth-skeleton";
import { FormAlert } from "@/components/auth/form-alert";
import { ResetForm } from "@/components/auth/reset-form";
import { Button } from "@/components/ui/button";
import { authConfigured, getCurrentUser } from "@/lib/auth/server";

export const metadata: Metadata = { title: "Choose a new password" };

export default function ResetPasswordPage() {
  return (
    <AuthShell>
      <AuthCard title="Choose a new password">
        <Suspense fallback={<AuthFormSkeleton fields={2} extra={false} />}>
          <Content />
        </Suspense>
      </AuthCard>
    </AuthShell>
  );
}

async function Content() {
  await connection();
  if (!authConfigured()) return <NotConfigured />;
  const user = await getCurrentUser().catch(() => null);
  if (!user) {
    return (
      <div className="grid gap-4">
        <FormAlert>This reset link has expired or was already used. Ask for a new one.</FormAlert>
        <Button asChild variant="pill" size="lg" className="w-full">
          <Link href="/forgot-password">Send a new link</Link>
        </Button>
      </div>
    );
  }
  return (
    <div className="grid gap-4">
      <p className="text-[14px] text-muted-foreground">
        Signed in as <span className="text-foreground">{user.email}</span>.
      </p>
      <ResetForm />
    </div>
  );
}
