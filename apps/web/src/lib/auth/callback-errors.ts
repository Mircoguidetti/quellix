const MESSAGES: Record<string, string> = {
  link_expired: "This link has expired or was already used. Request a new one.",
  auth: "We could not sign you in with that link. Try again.",
  oauth: "Google sign-in was cancelled or failed. Try again, or use your email and password.",
  not_configured: "Sign-in is not configured on this deployment yet.",
};

/** Messages for the `?error=` codes the auth callback sends back. Unknown codes get a generic one. */
export function callbackErrorMessage(code: string | null): string | null {
  if (!code) return null;
  return MESSAGES[code] ?? MESSAGES.auth;
}
