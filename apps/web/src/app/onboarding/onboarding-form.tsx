"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Building2, FileCheck2, ListChecks, Upload } from "lucide-react";
import { FormAlert } from "@/components/auth/form-alert";
import { isRedirect } from "@/components/auth/login-form";
import { Button } from "@/components/ui/button";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { clientTimeout, NETWORK_ERROR } from "@/lib/client-timeout";
import { createOrganization } from "./actions";

const schema = z.object({ name: z.string().trim().min(2, "Use at least 2 characters.").max(200, "Use at most 200 characters.") });

const NEXT_STEPS = [
  { icon: ListChecks, text: "Write a rubric from your lab's spec" },
  { icon: Upload, text: "Upload videos or call the API" },
  { icon: FileCheck2, text: "Review only the doubtful ones" },
];

export function OnboardingForm({ additional, greeting }: { additional: boolean; greeting: string }) {
  const form = useForm<z.infer<typeof schema>>({ resolver: zodResolver(schema), defaultValues: { name: "" } });
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const onSubmit = (values: z.infer<typeof schema>) =>
    start(async () => {
      setError(null);
      try {
        const res = await clientTimeout(createOrganization(values, additional));
        if (res && !res.ok) setError(res.error);
      } catch (e) {
        if (isRedirect(e)) throw e;
        setError(NETWORK_ERROR);
      }
    });

  return (
    <>
      <div className="mb-7 text-center">
        <span className="mx-auto mb-4 grid size-11 place-items-center rounded-xl border border-border bg-card text-accent-foreground">
          <Building2 className="size-5" aria-hidden />
        </span>
        <p className="font-mono text-[12px] uppercase tracking-[0.1em] text-muted-foreground">{additional ? "New organization" : greeting}</p>
        <h1 className="mt-2 text-[28px] font-medium leading-tight tracking-[-0.025em]">
          {additional ? "Add an organization" : "Name your organization"}
        </h1>
        <p className="mt-2 text-[15px] text-muted-foreground">Rubrics, videos, API keys and your team live inside it.</p>
      </div>
      <div className="rounded-2xl border border-border bg-card p-6 shadow-[0_40px_120px_-40px_rgba(143,180,255,0.25)] sm:p-7">
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} noValidate className="grid gap-4">
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Organization name</FormLabel>
                  <FormControl>
                    <Input autoComplete="organization" placeholder="Northwind Capture" autoFocus className="h-10" {...field} />
                  </FormControl>
                  <FormDescription>Usually your company name.</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            {error && <FormAlert>{error}</FormAlert>}
            <Button type="submit" variant="pill" size="lg" className="mt-1 w-full" loading={pending}>
              {additional ? "Create organization" : "Continue to Quellix"}
            </Button>
            {additional && (
              <Link href="/app" className="mx-auto rounded text-[13px] text-muted-foreground hover:text-foreground">
                Cancel
              </Link>
            )}
          </form>
        </Form>
        <ol className="mt-6 grid gap-2.5 border-t border-border pt-5" aria-label="What comes next">
          {NEXT_STEPS.map(({ icon: Icon, text }, i) => (
            <li key={text} className="flex items-center gap-3 text-[13.5px] text-muted-foreground">
              <span className="grid size-6 place-items-center rounded-md bg-accent font-mono text-[11px] text-accent-foreground">{i + 1}</span>
              <Icon className="size-4" aria-hidden />
              {text}
            </li>
          ))}
        </ol>
      </div>
    </>
  );
}
