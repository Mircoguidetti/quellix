import { describe, expect, it } from "vitest";
import { configuredSiteUrl, normalizeSiteUrl, siteUrl } from "./site-url";

describe("normalizeSiteUrl", () => {
  it("adds https:// to a bare host", () => {
    expect(normalizeSiteUrl("quellix-orpin.vercel.app")).toBe("https://quellix-orpin.vercel.app");
    expect(normalizeSiteUrl("  quellix.app/ ")).toBe("https://quellix.app");
  });

  it("keeps the scheme and port, and drops trailing slashes and paths", () => {
    expect(normalizeSiteUrl("https://quellix.app/")).toBe("https://quellix.app");
    expect(normalizeSiteUrl("http://localhost:3100")).toBe("http://localhost:3100");
    expect(normalizeSiteUrl("https://quellix.app/some/path?x=1")).toBe("https://quellix.app");
  });

  it("returns null for empty or invalid values", () => {
    for (const bad of [undefined, null, "", "   ", "not a url", "https://", "ftp://quellix.app", "javascript:alert(1)", "https://exa mple.com"]) {
      expect(normalizeSiteUrl(bad), String(bad)).toBeNull();
    }
  });
});

describe("siteUrl", () => {
  it("prefers NEXT_PUBLIC_SITE_URL, then the Vercel production domain, then localhost", () => {
    expect(siteUrl({ NEXT_PUBLIC_SITE_URL: "quellix.app", VERCEL_PROJECT_PRODUCTION_URL: "x.vercel.app" })).toBe("https://quellix.app");
    expect(siteUrl({ NEXT_PUBLIC_SITE_URL: "%%%", VERCEL_PROJECT_PRODUCTION_URL: "x.vercel.app" })).toBe("https://x.vercel.app");
    expect(siteUrl({})).toBe("http://localhost:3000");
  });

  it("always returns something new URL() accepts", () => {
    for (const value of ["quellix-orpin.vercel.app", "garbage value", "https://ok.app/"]) {
      expect(() => new URL(siteUrl({ NEXT_PUBLIC_SITE_URL: value }))).not.toThrow();
    }
  });
});

describe("configuredSiteUrl", () => {
  it("has no fallback", () => {
    expect(configuredSiteUrl({})).toBeNull();
    expect(configuredSiteUrl({ NEXT_PUBLIC_SITE_URL: "quellix.app/" })).toBe("https://quellix.app");
  });
});
