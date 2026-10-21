import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { demoClient } from "@/lib/demo/store";
import { isDemoMode } from "@/lib/demo/mode";
import { supabaseServiceRoleKey, supabaseUrl } from "@/lib/env";

/** Service-role client. Bypasses RLS: server-side only, always scope queries by org_id. */
export function createAdminClient(): SupabaseClient {
  if (isDemoMode()) return demoClient() as unknown as SupabaseClient;
  return createClient(supabaseUrl(), supabaseServiceRoleKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
