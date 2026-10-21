/** Turn Supabase Auth errors into messages a customer can act on. Never shows raw error text. */
export function friendlyAuthError(error: { message?: string; code?: string; status?: number } | null | undefined): string {
  const code = error?.code ?? "";
  const message = (error?.message ?? "").toLowerCase();
  if (code === "timeout") return "The sign-in service took too long to answer. Check your connection and try again.";
  if (code === "invalid_credentials" || message.includes("invalid login credentials")) return "Email or password is incorrect.";
  if (code === "email_not_confirmed" || message.includes("email not confirmed")) return "Confirm your email first. Use the link we sent you, or send a new one.";
  if (code === "user_already_exists" || code === "email_exists" || message.includes("already registered")) return "An account with this email already exists. Sign in instead.";
  if (code === "weak_password" || message.includes("password should")) return "Choose a stronger password: at least 8 characters, mixing letters and numbers.";
  if (code === "same_password") return "Choose a password you have not used for this account.";
  if (code === "over_email_send_rate_limit" || code === "over_request_rate_limit" || error?.status === 429 || message.includes("rate limit"))
    return "Too many attempts. Wait a minute and try again.";
  if (code === "validation_failed" && message.includes("provider")) return "Google sign-in is not enabled yet. Use your email and password.";
  if (message.includes("provider is not enabled") || message.includes("unsupported provider")) return "Google sign-in is not enabled yet. Use your email and password.";
  if (code === "session_not_found" || code === "session_expired" || message.includes("auth session missing"))
    return "This link has expired. Request a new one.";
  if (code === "otp_expired" || message.includes("expired")) return "This link has expired or was already used. Request a new one.";
  if (code === "signup_disabled") return "New accounts are not open yet. Ask your administrator for an invitation.";
  if (message.includes("fetch failed") || message.includes("network")) return "We could not reach the sign-in service. Check your connection and try again.";
  return "Something went wrong on our side. Try again in a moment.";
}

export class TimeoutError extends Error {
  code = "timeout";
}

export function withTimeout<T>(promise: PromiseLike<T>, ms = 12_000): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new TimeoutError("timeout")), ms);
    Promise.resolve(promise).then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}
