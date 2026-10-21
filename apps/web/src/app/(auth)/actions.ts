"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import {
  googleSignInUrl,
  passwordSignIn,
  passwordSignUp,
  requestPasswordReset,
  resendConfirmation,
  sendMagicLink,
  setNewPassword,
  type AuthResult,
} from "@/lib/auth/server";
import { emailField, forgotSchema, resetSchema, signInSchema, signUpSchema } from "@/lib/auth/schemas";
import { safeNext } from "@/lib/safe-redirect";

const INVALID: AuthResult = { ok: false, error: "Check the highlighted fields." };

export async function signInAction(raw: unknown, next: string | null): Promise<AuthResult> {
  const input = signInSchema.safeParse(raw);
  if (!input.success) return INVALID;
  const res = await passwordSignIn(input.data.email, input.data.password);
  if (!res.ok) return res;
  redirect(safeNext(next));
}

export async function signUpAction(raw: unknown): Promise<AuthResult & { confirm?: boolean }> {
  const input = signUpSchema.safeParse(raw);
  if (!input.success) return INVALID;
  const res = await passwordSignUp(input.data.email, input.data.password, input.data.name);
  if (!res.ok) return res;
  if (res.signedIn) redirect("/onboarding");
  return { ok: true, confirm: true };
}

export async function resendConfirmationAction(email: string): Promise<AuthResult> {
  const parsed = emailField.safeParse(email);
  if (!parsed.success) return INVALID;
  return resendConfirmation(parsed.data);
}

export async function forgotPasswordAction(raw: unknown): Promise<AuthResult> {
  const input = forgotSchema.safeParse(raw);
  if (!input.success) return INVALID;
  return requestPasswordReset(input.data.email);
}

export async function resetPasswordAction(raw: unknown): Promise<AuthResult> {
  const input = resetSchema.safeParse(raw);
  if (!input.success) return INVALID;
  const res = await setNewPassword(input.data.password);
  if (!res.ok) return res;
  redirect("/app");
}

export async function magicLinkAction(email: string, next: string | null): Promise<AuthResult> {
  const parsed = emailField.safeParse(email);
  if (!parsed.success) return { ok: false, error: "Enter your email first, then ask for a link.", code: "email" };
  return sendMagicLink(parsed.data, safeNext(next));
}

export async function googleAction(next: string | null): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  return googleSignInUrl(safeNext(z.string().nullable().parse(next)));
}
