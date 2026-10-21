import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { AuthCard, AuthShell } from "@/components/auth/auth-shell";
import { AuthFormSkeleton, NotConfigured } from "@/components/auth/auth-skeleton";
import { SignUpForm } from "@/components/auth/signup-form";
import { authConfigured, googleEnabled } from "@/lib/auth/server";

export const metadata: Metadata = { title: "Create account" };

export default function SignUpPage() {
  return (
    <AuthShell>
      <AuthCard title="Create your account" description="Set up your rubric and see your first decisions in minutes.">
        <Suspense fallback={<AuthFormSkeleton fields={3} />}>
          <Content />
        </Suspense>
      </AuthCard>
      <p className="mt-6 text-[14px] text-muted-foreground">
        Already have an account?{" "}
        <Link href="/login" className="rounded font-medium text-foreground underline-offset-4 hover:underline">
          Sign in
        </Link>
      </p>
    </AuthShell>
  );
}

async function Content() {
  await connection();
  if (!authConfigured()) return <NotConfigured />;
  return <SignUpForm google={googleEnabled()} />;
}
