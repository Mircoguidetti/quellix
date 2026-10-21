import { Suspense } from "react";
import { redirect } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";
import { createOrganization } from "./actions";
import { button, input } from "@/components/ui";

export const metadata = { title: "Create your organization · Quellix" };

export default function OnboardingPage() {
  return (
    <Suspense>
      <Onboarding />
    </Suspense>
  );
}

async function Onboarding() {
  const supabase = await createServerSupabase();
  const { data } = await supabase.auth.getUser();
  if (!data.user) redirect("/login");
  const { count } = await supabase.from("members").select("*", { count: "exact", head: true });
  if (count) redirect("/app");

  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-6 px-4 py-12">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Create your organization</h1>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          Your videos, rubrics and API keys live inside an organization.
        </p>
      </div>
      <form action={createOrganization} className="flex flex-col gap-3">
        <label htmlFor="name" className="text-sm font-medium">
          Organization name
        </label>
        <input id="name" name="name" required maxLength={200} className={input} />
        <button type="submit" className={button("primary")}>
          Create organization
        </button>
      </form>
    </main>
  );
}
