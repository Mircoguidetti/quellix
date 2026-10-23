import { isDemoMode } from "@/lib/demo/mode";

/**
 * Shadow pilots need the `pilots` / `pilot_items` tables and `videos.shadow` (proposed migration,
 * issue #65). Until it is applied, set nothing: every query that reads those columns stays off.
 * Turn on with QUELLIX_PILOTS=1 once the migration is live. Always on in demo mode.
 */
export function pilotsEnabled(): boolean {
  return process.env.QUELLIX_PILOTS === "1" || isDemoMode();
}
