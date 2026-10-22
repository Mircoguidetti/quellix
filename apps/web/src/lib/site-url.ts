import { z } from "zod";

const LOCAL = "http://localhost:3000";

// An http(s) origin with a real host. Anything else (garbage, other schemes, paths only) is rejected.
const origin = z
  .url({ protocol: /^https?$/, hostname: z.regexes.hostname })
  .transform((value) => new URL(value).origin);

/**
 * Normalises a configured site URL to an origin like "https://quellix.app".
 * Adds "https://" when the scheme is missing (Vercel hosts are often set bare), drops any path or
 * trailing slash, and returns null for anything that is not a valid http(s) URL.
 */
export function normalizeSiteUrl(raw: string | undefined | null): string | null {
  const value = raw?.trim();
  if (!value) return null;
  const withScheme = /^[a-z][a-z\d+.-]*:\/\//i.test(value) ? value : `https://${value}`;
  const parsed = origin.safeParse(withScheme);
  return parsed.success ? parsed.data : null;
}

/**
 * The public origin of the site, for absolute links (emails, Open Graph). Never throws:
 * NEXT_PUBLIC_SITE_URL, else Vercel's production domain, else localhost.
 */
export function siteUrl(env: Record<string, string | undefined> = process.env): string {
  return normalizeSiteUrl(env.NEXT_PUBLIC_SITE_URL) ?? normalizeSiteUrl(env.VERCEL_PROJECT_PRODUCTION_URL) ?? LOCAL;
}

/** Only the configured value (no fallback), for callers that can derive the origin from the request. */
export function configuredSiteUrl(env: Record<string, string | undefined> = process.env): string | null {
  return normalizeSiteUrl(env.NEXT_PUBLIC_SITE_URL);
}
