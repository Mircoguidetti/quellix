"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { MailCheck } from "lucide-react";
import { googleAction, resendConfirmationAction, signUpAction } from "@/app/(auth)/actions";
import { Button } from "@/components/ui/button";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { signUpSchema, type SignUpValues } from "@/lib/auth/schemas";
import { clientTimeout, NETWORK_ERROR } from "@/lib/client-timeout";
import { FormAlert } from "./form-alert";
import { GoogleButton } from "./google-button";
import { Divider, isRedirect } from "./login-form";
import { PasswordInput } from "./password-input";

export function SignUpForm({ google }: { google: boolean }) {
  const form = useForm<SignUpValues>({ resolver: zodResolver(signUpSchema), defaultValues: { name: "", email: "", password: "" } });
  const [error, setError] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [resent, setResent] = useState(false);
  const [pending, start] = useTransition();
  const [resendPending, startResend] = useTransition();

  const onSubmit = (values: SignUpValues) =>
    start(async () => {
      setError(null);
      try {
        const res = await clientTimeout(signUpAction(values));
        if (!res) return;
        if (!res.ok) {
          setError(res.error);
          if (res.code === "user_already_exists") form.setFocus("email");
          return;
        }
        if (res.confirm) setSentTo(values.email);
      } catch (e) {
        if (isRedirect(e)) throw e;
        setError(NETWORK_ERROR);
      }
    });

  if (sentTo) {
    return (
      <div className="grid gap-5 text-center">
        <span className="mx-auto grid size-12 place-items-center rounded-full bg-accent text-accent-foreground">
          <MailCheck className="size-5" aria-hidden />
        </span>
        <div className="grid gap-1.5">
          <h2 className="text-lg font-medium">Check your inbox</h2>
          <p className="text-[14.5px] text-muted-foreground">
            We sent a confirmation link to <span className="text-foreground">{sentTo}</span>. Open it on this device to finish creating your account.
          </p>
        </div>
        {resent && <FormAlert tone="success">A new link is on its way.</FormAlert>}
        {error && <FormAlert>{error}</FormAlert>}
        <Button
          variant="pill-outline"
          size="lg"
          className="w-full"
          loading={resendPending}
          onClick={() =>
            startResend(async () => {
              setError(null);
              try {
                const res = await clientTimeout(resendConfirmationAction(sentTo));
                if (res.ok) setResent(true);
                else setError(res.error);
              } catch {
                setError(NETWORK_ERROR);
              }
            })
          }
        >
          Send the link again
        </Button>
        <button type="button" className="mx-auto rounded text-[13px] text-muted-foreground hover:text-foreground" onClick={() => setSentTo(null)}>
          Use a different email
        </button>
      </div>
    );
  }

  return (
    <div className="grid gap-5">
      {google && (
        <>
          <GoogleButton action={() => googleAction("/app")} onError={setError} />
          <Divider />
        </>
      )}
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} noValidate className="grid gap-4">
          <FormField
            control={form.control}
            name="name"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Full name</FormLabel>
                <FormControl>
                  <Input autoComplete="name" placeholder="Alex Morgan" className="h-10" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
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
          <FormField
            control={form.control}
            name="password"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Password</FormLabel>
                <FormControl>
                  <PasswordInput autoComplete="new-password" className="h-10" {...field} />
                </FormControl>
                <FormDescription>At least 8 characters, with letters and numbers.</FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
          {error && (
            <FormAlert>
              {error}
              {error.includes("Sign in instead") && (
                <>
                  {" "}
                  <Link href="/login" className="font-medium underline underline-offset-2">
                    Go to sign in
                  </Link>
                </>
              )}
            </FormAlert>
          )}
          <Button type="submit" variant="pill" size="lg" className="mt-1 w-full" loading={pending}>
            Create account
          </Button>
          <p className="text-center text-[12.5px] leading-relaxed text-muted-foreground">
            By creating an account you accept how we{" "}
            <Link href="/data" className="text-foreground underline underline-offset-2">
              handle data
            </Link>{" "}
            and our{" "}
            <Link href="/dpa" className="text-foreground underline underline-offset-2">
              DPA
            </Link>
            .
          </p>
        </form>
      </Form>
    </div>
  );
}
