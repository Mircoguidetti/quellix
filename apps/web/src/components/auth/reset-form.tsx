"use client";

import { useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { resetPasswordAction } from "@/app/(auth)/actions";
import { Button } from "@/components/ui/button";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { resetSchema, type ResetValues } from "@/lib/auth/schemas";
import { clientTimeout, NETWORK_ERROR } from "@/lib/client-timeout";
import { FormAlert } from "./form-alert";
import { isRedirect } from "./login-form";
import { PasswordInput } from "./password-input";

export function ResetForm() {
  const form = useForm<ResetValues>({ resolver: zodResolver(resetSchema), defaultValues: { password: "", confirm: "" } });
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const onSubmit = (values: ResetValues) =>
    start(async () => {
      setError(null);
      try {
        const res = await clientTimeout(resetPasswordAction(values));
        if (res && !res.ok) setError(res.error);
      } catch (e) {
        if (isRedirect(e)) throw e;
        setError(NETWORK_ERROR);
      }
    });

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} noValidate className="grid gap-4">
        <FormField
          control={form.control}
          name="password"
          render={({ field }) => (
            <FormItem>
              <FormLabel>New password</FormLabel>
              <FormControl>
                <PasswordInput autoComplete="new-password" className="h-10" {...field} />
              </FormControl>
              <FormDescription>At least 8 characters, with letters and numbers.</FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="confirm"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Repeat the new password</FormLabel>
              <FormControl>
                <PasswordInput autoComplete="new-password" className="h-10" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        {error && <FormAlert>{error}</FormAlert>}
        <Button type="submit" variant="pill" size="lg" className="mt-1 w-full" loading={pending}>
          Save and continue
        </Button>
      </form>
    </Form>
  );
}
