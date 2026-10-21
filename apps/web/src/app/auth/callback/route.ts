import { NextResponse, type NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { authConfigured } from "@/lib/auth/server";
import { withTimeout } from "@/lib/auth/errors";
import { createServerSupabase } from "@/lib/supabase/server";
import { safeNext } from "@/lib/safe-redirect";

const OTP_TYPES = new Set(["signup", "invite", "magiclink", "recovery", "email_change", "email"]);

/** Lands every email link (confirmation, magic link, reset, invite) and the Google redirect. */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const next = safeNext(searchParams.get("next"));
  const failTo = next === "/reset-password" ? "/forgot-password" : "/login";
  const fail = (code: string) => NextResponse.redirect(`${origin}${failTo}?error=${code}`);

  if (!authConfigured()) return fail("not_configured");
  if (searchParams.get("error")) return fail(searchParams.get("error_code") === "otp_expired" ? "link_expired" : "oauth");

  try {
    const supabase = await createServerSupabase();
    const code = searchParams.get("code");
    const tokenHash = searchParams.get("token_hash");
    const type = searchParams.get("type");
    if (code) {
      const { error } = await withTimeout(supabase.auth.exchangeCodeForSession(code));
      if (error) return fail("link_expired");
    } else if (tokenHash && type && OTP_TYPES.has(type)) {
      const { error } = await withTimeout(supabase.auth.verifyOtp({ token_hash: tokenHash, type: type as EmailOtpType }));
      if (error) return fail("link_expired");
    } else {
      return fail("auth");
    }
  } catch {
    return fail("auth");
  }
  return NextResponse.redirect(`${origin}${next}`);
}
