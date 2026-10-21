"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowLeft, MailCheck } from "lucide-react";
import { forgotPasswordAction } from "@/app/(auth)/actions";
import { Button } from "@/components/ui/button";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { forgotSchema, type ForgotValues } from "@/lib/auth/schemas";
import { clientTimeout, NETWORK_ERROR } from "@/lib/client-timeout";
import { FormAlert } from "./form-alert";

export function ForgotForm({ initialError }: { initialError: string | null }) {
  const form = useForm<ForgotValues>({ resolver: zodResolver(forgotSchema), defaultValues: { email: "" } });
  const [error, setError] = useState<string | null>(initialError);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const onSubmit = (values: ForgotValues) =>
    start(async () => {
      setError(null);
      try {
        const res = await clientTimeout(forgotPasswordAction(values));
        if (res.ok) setSentTo(values.email);
        else setError(res.error);
      } catch {
        setError(NETWORK_ERROR);
      }
    });

  if (sentTo) {
    return (
      <div className="grid gap-5 text-center">
        <span className="mx-auto grid size-12 place-items-center rounded-full bg-accent text-accent-foreground">
          <MailCheck className="size-5" aria-hidden />
        </span>
        <p className="text-[14.5px] text-muted-foreground">
          If <span className="text-foreground">{sentTo}</span> has an account, a link to choose a new password is on its way. It works for one hour.
        </p>
        <Button asChild variant="pill-outline" size="lg" className="w-full">
          <Link href="/login">
            <ArrowLeft aria-hidden />
            Back to sign in
          </Link>
        </Button>
      </div>
    );
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} noValidate className="grid gap-4">
        <FormField
          control={form.control}
          name="email"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Work email</FormLabel>
              <FormControl>
                <Input type="email" autoComplete="email" placeholder="you@company.com" className="h-10" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        {error && <FormAlert>{error}</FormAlert>}
        <Button type="submit" variant="pill" size="lg" className="mt-1 w-full" loading={pending}>
          Send reset link
        </Button>
        <Link href="/login" className="mx-auto inline-flex items-center gap-1.5 rounded text-[13px] text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-3.5" aria-hidden />
          Back to sign in
        </Link>
      </form>
    </Form>
  );
}
