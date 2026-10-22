import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { AuthCard, AuthShell } from "@/components/auth/auth-shell";
import { AuthFormSkeleton, NotConfigured } from "@/components/auth/auth-skeleton";
import { LoginForm } from "@/components/auth/login-form";
import { authConfigured, googleEnabled } from "@/lib/auth/server";
import { callbackErrorMessage } from "@/lib/auth/callback-errors";

export const metadata: Metadata = { title: "Sign in" };

export default function LoginPage({ searchParams }: PageProps<"/login">) {
  return (
    <AuthShell>
      <AuthCard title="Sign in to Ormes" description="Decide every video the same way, review only the doubtful ones.">
        <Suspense fallback={<AuthFormSkeleton />}>
          <Content searchParams={searchParams} />
        </Suspense>
      </AuthCard>
      <p className="mt-6 text-[14px] text-muted-foreground">
        New to Ormes?{" "}
        <Link href="/signup" className="rounded font-medium text-foreground underline-offset-4 hover:underline">
          Create an account
        </Link>
      </p>
    </AuthShell>
  );
}

async function Content({ searchParams }: { searchParams: PageProps<"/login">["searchParams"] }) {
  const sp = await searchParams;
  if (!authConfigured()) return <NotConfigured />;
  const next = typeof sp.next === "string" ? sp.next : null;
  const error = callbackErrorMessage(typeof sp.error === "string" ? sp.error : null);
  return <LoginForm next={next} initialError={error} google={googleEnabled()} />;
}
