"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Mail } from "lucide-react";
import { googleAction, magicLinkAction, resendConfirmationAction, signInAction } from "@/app/(auth)/actions";
import { Button } from "@/components/ui/button";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { signInSchema, type SignInValues } from "@/lib/auth/schemas";
import { clientTimeout, NETWORK_ERROR } from "@/lib/client-timeout";
import { FormAlert } from "./form-alert";
import { GoogleButton } from "./google-button";
import { PasswordInput } from "./password-input";

type Notice = { tone: "error" | "success" | "info"; text: string; resend?: string } | null;

export function LoginForm({ next, initialError, google }: { next: string | null; initialError: string | null; google: boolean }) {
  const form = useForm<SignInValues>({ resolver: zodResolver(signInSchema), defaultValues: { email: "", password: "" } });
  const [notice, setNotice] = useState<Notice>(initialError ? { tone: "error", text: initialError } : null);
  const [pending, start] = useTransition();
  const [linkPending, startLink] = useTransition();
  const [resendPending, startResend] = useTransition();

  const onSubmit = (values: SignInValues) =>
    start(async () => {
      setNotice(null);
      try {
        const res = await clientTimeout(signInAction(values, next));
        if (res && !res.ok) {
          setNotice({ tone: "error", text: res.error, resend: res.code === "email_not_confirmed" ? values.email : undefined });
          if (res.code === "invalid_credentials") form.setFocus("password");
        }
      } catch (e) {
        if (isRedirect(e)) throw e;
        setNotice({ tone: "error", text: NETWORK_ERROR });
      }
    });

  const magicLink = () =>
    startLink(async () => {
      setNotice(null);
      const email = form.getValues("email");
      try {
        const res = await clientTimeout(magicLinkAction(email, next));
        if (res.ok) setNotice({ tone: "success", text: `If ${email} has an account, a sign-in link is on its way. It works for one hour.` });
        else {
          setNotice({ tone: "error", text: res.error });
          if (res.code === "email") form.setFocus("email");
        }
      } catch {
        setNotice({ tone: "error", text: NETWORK_ERROR });
      }
    });

  const resend = (email: string) =>
    startResend(async () => {
      try {
        const res = await clientTimeout(resendConfirmationAction(email));
        setNotice(res.ok ? { tone: "success", text: `We sent a new confirmation link to ${email}.` } : { tone: "error", text: res.error });
      } catch {
        setNotice({ tone: "error", text: NETWORK_ERROR });
      }
    });

  return (
    <div className="grid gap-5">
      {google && (
        <>
          <GoogleButton action={() => googleAction(next)} onError={(text) => setNotice({ tone: "error", text })} />
          <Divider />
        </>
      )}

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
          <FormField
            control={form.control}
            name="password"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Password</FormLabel>
                <FormControl>
                  <PasswordInput autoComplete="current-password" className="h-10" {...field} />
                </FormControl>
                <FormMessage />
                <Link href="/forgot-password" className="justify-self-end rounded text-[13px] text-muted-foreground transition-colors hover:text-foreground">
                  Forgot password?
                </Link>
              </FormItem>
            )}
          />

          {notice && (
            <FormAlert tone={notice.tone}>
              {notice.text}
              {notice.resend && (
                <Button type="button" variant="link" size="sm" className="ml-1 h-auto text-[13.5px] text-current" loading={resendPending} onClick={() => resend(notice.resend!)}>
                  Send a new link
                </Button>
              )}
            </FormAlert>
          )}

          <Button type="submit" variant="pill" size="lg" className="mt-1 w-full" loading={pending}>
            Sign in
          </Button>
          <Button type="button" variant="ghost" size="sm" className="mx-auto text-muted-foreground" loading={linkPending} onClick={magicLink}>
            <Mail aria-hidden />
            Email me a sign-in link instead
          </Button>
        </form>
      </Form>
    </div>
  );
}

export function Divider() {
  return (
    <div className="flex items-center gap-3 font-mono text-[11px] uppercase tracking-[0.1em] text-muted-foreground" role="separator">
      <span className="h-px flex-1 bg-border" />
      or
      <span className="h-px flex-1 bg-border" />
    </div>
  );
}

/** Server actions that call redirect() reject with a special error the router must see. */
export function isRedirect(e: unknown): boolean {
  return typeof e === "object" && e !== null && "digest" in e && String((e as { digest: unknown }).digest).startsWith("NEXT_REDIRECT");
}
