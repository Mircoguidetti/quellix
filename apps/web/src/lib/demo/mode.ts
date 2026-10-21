/**
 * Demo mode serves the dashboard from seeded in-memory data instead of Supabase, for local
 * screenshots, end-to-end tests and sales demos. It is opt-in with a server-only variable and
 * refused on Vercel production, so a misconfigured deploy can never show fake data to a customer.
 */
export function isDemoMode(): boolean {
  return process.env.QUELLIX_DEMO === "1" && process.env.VERCEL_ENV !== "production";
}

export const DEMO_SESSION_COOKIE = "qx_demo_session";
export const DEMO_EMAIL = "demo@quellix.dev";
export const DEMO_PASSWORD = "quellix-demo";
