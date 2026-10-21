"use client";

import { useState } from "react";
import { createBrowserSupabase } from "@/lib/supabase/browser";
import { safeNext } from "@/lib/safe-redirect";
import { button, input } from "@/components/ui";

function callbackUrl() {
  const next = safeNext(new URLSearchParams(window.location.search).get("next"));
  return `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`;
}

export function LoginForm() {
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function google() {
    setError(null);
    const { error } = await createBrowserSupabase().auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: callbackUrl() },
    });
    if (error) setError(error.message);
  }

  async function magicLink(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error } = await createBrowserSupabase().auth.signInWithOtp({
      email,
      options: { emailRedirectTo: callbackUrl() },
    });
    setBusy(false);
    if (error) setError(error.message);
    else setMessage("Check your inbox for the sign-in link.");
  }

  return (
    <div className="flex flex-col gap-4">
      <button type="button" onClick={google} className={button("secondary")}>
        Continue with Google
      </button>
      <div className="text-center text-xs text-zinc-500">or</div>
      <form onSubmit={magicLink} className="flex flex-col gap-3">
        <label className="text-sm font-medium" htmlFor="email">
          Work email
        </label>
        <input
          id="email"
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className={input}
          placeholder="you@company.com"
        />
        <button type="submit" disabled={busy} className={button("primary")}>
          {busy ? "Sending…" : "Email me a link"}
        </button>
      </form>
      {message && <p className="text-sm text-emerald-700 dark:text-emerald-400">{message}</p>}
      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
    </div>
  );
}
