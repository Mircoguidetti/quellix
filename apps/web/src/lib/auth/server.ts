import "server-only";
import { randomUUID } from "node:crypto";
import { cookies, headers } from "next/headers";
import { connection } from "next/server";
import { DEMO_SESSION_COOKIE, isDemoMode } from "@/lib/demo/mode";
import { demoStore } from "@/lib/demo/store";
import { createServerSupabase } from "@/lib/supabase/server";
import { safeNext } from "@/lib/safe-redirect";
import { friendlyAuthError, withTimeout } from "./errors";

export type AuthUser = { id: string; email: string | undefined; name: string | undefined };
export type AuthResult = { ok: true; message?: string } | { ok: false; error: string; code?: string };

/** True when sign-in can work: Supabase env vars are present, or demo mode is on. */
export function authConfigured(): boolean {
  return isDemoMode() || Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
}

export function googleEnabled(): boolean {
  return process.env.NEXT_PUBLIC_AUTH_GOOGLE !== "0";
}

const NOT_CONFIGURED: AuthResult = { ok: false, error: "Sign-in is not configured on this deployment yet.", code: "not_configured" };

/** Where links in emails should land. */
async function origin(): Promise<string> {
  if (process.env.NEXT_PUBLIC_SITE_URL) return process.env.NEXT_PUBLIC_SITE_URL.replace(/\/$/, "");
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

async function callback(next: string): Promise<string> {
  return `${await origin()}/auth/callback?next=${encodeURIComponent(safeNext(next))}`;
}

function fail(error: unknown): AuthResult {
  const e = error as { message?: string; code?: string; status?: number };
  return { ok: false, error: friendlyAuthError(e), code: e?.code };
}

// ---------------------------------------------------------------- demo backend

async function demoSetSession(userId: string | null) {
  const jar = await cookies();
  if (userId) jar.set(DEMO_SESSION_COOKIE, userId, { httpOnly: true, sameSite: "lax", path: "/" });
  else jar.delete(DEMO_SESSION_COOKIE);
}

function demoUser(email: string) {
  return demoStore().users.find((u) => u.email.toLowerCase() === email.toLowerCase());
}

// ---------------------------------------------------------------- public API

export async function getCurrentUser(): Promise<AuthUser | null> {
  // Request-time only, in every mode: a page must never be prerendered as "signed out", and
  // session data (and the clock) must not be read during a runtime prefetch.
  await connection();
  const jar = await cookies();
  if (isDemoMode()) {
    const id = jar.get(DEMO_SESSION_COOKIE)?.value;
    const user = id ? demoStore().users.find((u) => u.id === id) : undefined;
    return user ? { id: user.id, email: user.email, name: user.name } : null;
  }
  if (!authConfigured()) return null;
  const supabase = await createServerSupabase();
  const { data } = await withTimeout(supabase.auth.getUser());
  if (!data.user) return null;
  const meta = data.user.user_metadata as { full_name?: string; name?: string } | undefined;
  return { id: data.user.id, email: data.user.email, name: meta?.full_name ?? meta?.name };
}

export async function passwordSignIn(email: string, password: string): Promise<AuthResult> {
  if (isDemoMode()) {
    const user = demoUser(email);
    if (!user || user.password !== password) return { ok: false, error: friendlyAuthError({ code: "invalid_credentials" }), code: "invalid_credentials" };
    await demoSetSession(user.id);
    return { ok: true };
  }
  if (!authConfigured()) return NOT_CONFIGURED;
  try {
    const supabase = await createServerSupabase();
    const { error } = await withTimeout(supabase.auth.signInWithPassword({ email, password }));
    return error ? fail(error) : { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function passwordSignUp(email: string, password: string, name: string): Promise<AuthResult & { signedIn?: boolean }> {
  if (isDemoMode()) {
    if (demoUser(email)) return { ok: false, error: friendlyAuthError({ code: "user_already_exists" }), code: "user_already_exists" };
    const user = { id: randomUUID(), email, password, name, confirmed: true };
    demoStore().users.push(user);
    await demoSetSession(user.id);
    return { ok: true, signedIn: true };
  }
  if (!authConfigured()) return NOT_CONFIGURED;
  try {
    const supabase = await createServerSupabase();
    const { data, error } = await withTimeout(
      supabase.auth.signUp({ email, password, options: { data: { full_name: name }, emailRedirectTo: await callback("/app") } }),
    );
    if (error) return fail(error);
    // Supabase answers an existing, confirmed address with a user that has no identities.
    if (data.user && data.user.identities?.length === 0) {
      return { ok: false, error: friendlyAuthError({ code: "user_already_exists" }), code: "user_already_exists" };
    }
    return { ok: true, signedIn: Boolean(data.session) };
  } catch (e) {
    return fail(e);
  }
}

export async function resendConfirmation(email: string): Promise<AuthResult> {
  if (isDemoMode()) return { ok: true };
  if (!authConfigured()) return NOT_CONFIGURED;
  try {
    const supabase = await createServerSupabase();
    const { error } = await withTimeout(supabase.auth.resend({ type: "signup", email, options: { emailRedirectTo: await callback("/app") } }));
    return error ? fail(error) : { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function requestPasswordReset(email: string): Promise<AuthResult> {
  if (isDemoMode()) return { ok: true };
  if (!authConfigured()) return NOT_CONFIGURED;
  try {
    const supabase = await createServerSupabase();
    const { error } = await withTimeout(supabase.auth.resetPasswordForEmail(email, { redirectTo: await callback("/reset-password") }));
    // Do not reveal whether the address has an account: only surface rate limits and outages.
    if (error && (error.status === 429 || error.code?.startsWith("over_"))) return fail(error);
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function setNewPassword(password: string): Promise<AuthResult> {
  if (isDemoMode()) {
    const user = await getCurrentUser();
    const stored = user && demoStore().users.find((u) => u.id === user.id);
    if (!stored) return { ok: false, error: friendlyAuthError({ code: "session_not_found" }), code: "session_not_found" };
    stored.password = password;
    return { ok: true };
  }
  if (!authConfigured()) return NOT_CONFIGURED;
  try {
    const supabase = await createServerSupabase();
    const { error } = await withTimeout(supabase.auth.updateUser({ password }));
    return error ? fail(error) : { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function sendMagicLink(email: string, next: string): Promise<AuthResult> {
  if (isDemoMode()) return { ok: true };
  if (!authConfigured()) return NOT_CONFIGURED;
  try {
    const supabase = await createServerSupabase();
    const { error } = await withTimeout(
      supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: await callback(next), shouldCreateUser: false } }),
    );
    // Same answer whether or not the address exists.
    if (error && (error.status === 429 || error.code?.startsWith("over_"))) return fail(error);
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function googleSignInUrl(next: string): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  if (isDemoMode()) {
    const user = demoStore().users[0];
    await demoSetSession(user.id);
    return { ok: true, url: safeNext(next) };
  }
  if (!authConfigured()) return NOT_CONFIGURED as { ok: false; error: string };
  try {
    const supabase = await createServerSupabase();
    const { data, error } = await withTimeout(
      supabase.auth.signInWithOAuth({ provider: "google", options: { redirectTo: await callback(next), skipBrowserRedirect: true } }),
    );
    if (error || !data.url) return { ok: false, error: friendlyAuthError(error) };
    return { ok: true, url: data.url };
  } catch (e) {
    return { ok: false, error: friendlyAuthError(e as { message?: string; code?: string }) };
  }
}

export async function signOut(): Promise<void> {
  if (isDemoMode()) return demoSetSession(null);
  if (!authConfigured()) return;
  const supabase = await createServerSupabase();
  await withTimeout(supabase.auth.signOut()).catch(() => undefined);
}
