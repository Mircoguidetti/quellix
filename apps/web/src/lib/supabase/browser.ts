import { createBrowserClient } from "@supabase/ssr";

// NEXT_PUBLIC_* values are inlined at build time; read them directly here.
export function createBrowserSupabase() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
  );
}
