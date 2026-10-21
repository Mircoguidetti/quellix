import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { DEMO_SESSION_COOKIE, isDemoMode } from "@/lib/demo/mode";

const AUTH_PAGES = ["/login", "/signup"];

/**
 * Refreshes the Supabase session cookie, keeps signed-out visitors out of /app and /onboarding,
 * and sends signed-in visitors from the sign-in pages straight to the app.
 */
export async function proxy(request: NextRequest) {
  const isAuthPage = AUTH_PAGES.includes(request.nextUrl.pathname);
  let response = NextResponse.next({ request });

  let signedIn = false;
  if (isDemoMode()) {
    signedIn = Boolean(request.cookies.get(DEMO_SESSION_COOKIE)?.value);
  } else {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (url && anon) {
      const supabase = createServerClient(url, anon, {
        cookies: {
          getAll: () => request.cookies.getAll(),
          setAll: (list) => {
            for (const { name, value } of list) request.cookies.set(name, value);
            response = NextResponse.next({ request });
            for (const { name, value, options } of list) response.cookies.set(name, value, options);
          },
        },
      });
      const { data } = await supabase.auth.getClaims().catch(() => ({ data: null }));
      signedIn = Boolean(data?.claims);
    }
  }

  if (isAuthPage) return signedIn ? NextResponse.redirect(new URL("/app", request.url)) : response;
  if (!signedIn) return redirectToLogin(request);
  return response;
}

function redirectToLogin(request: NextRequest) {
  const login = new URL("/login", request.url);
  login.searchParams.set("next", request.nextUrl.pathname + request.nextUrl.search);
  return NextResponse.redirect(login);
}

export const config = {
  matcher: ["/app/:path*", "/onboarding", "/login", "/signup"],
};
