import path from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "./fixtures";

// The marketing site ported from docs/design/site (issue #35).
const OUT = path.join(__dirname, "screenshots");
const PAGES = [
  { route: "/", name: "home", title: "Quellix", h1: "Stop watching every video before you pay for it." },
  { route: "/product", name: "product", title: "Quellix Product", h1: "One spec, applied the same way to every video." },
  { route: "/developers", name: "developers", title: "Quellix Developers", h1: "Three calls from upload to decision." },
  { route: "/security", name: "security", title: "Quellix Security", h1: "Videos are checked, not kept." },
];
const DEMO_COOKIE = { name: "qx_demo_session", value: "d3e0d3e0-0000-4000-8000-000000000001", url: "http://localhost:3100" };

test.describe("marketing site", () => {
  for (const p of PAGES) {
    test(`${p.name}: renders, metadata, no overflow, screenshot`, async ({ page }, info) => {
      await page.goto(p.route);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(p.h1);
      await expect(page).toHaveTitle(p.title);
      await expect(page.locator('meta[property="og:image"]')).toHaveAttribute("content", /opengraph-image/);
      await page.waitForLoadState("networkidle");
      await page.evaluate(() => document.fonts.ready);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(page.viewportSize()!.width);
      await page.screenshot({ path: path.join(OUT, info.project.name, `site-${p.name}.png`), fullPage: true, caret: "hide" });
    });
  }

  test("Open Graph images are generated", async ({ request }) => {
    for (const p of PAGES) {
      const html = await (await request.get(p.route)).text();
      const url = /property="og:image" content="([^"]+)"/.exec(html)?.[1];
      expect(url, p.route).toBeTruthy();
      const res = await request.get(new URL(url!).pathname + new URL(url!).search);
      expect(res.status(), url).toBe(200);
      expect(res.headers()["content-type"]).toBe("image/png");
    }
  });

  test("hero trust row keeps the design's spacing and dots", async ({ page }) => {
    await page.goto("/");
    const trust = page.locator(".trust");
    await expect(trust).toHaveCSS("display", "flex");
    await expect(trust).toHaveCSS("column-gap", "18px");
    await expect(trust).toHaveCSS("row-gap", "8px");
    const dotWidth = await trust.locator("span").first().evaluate((el) => getComputedStyle(el, "::before").width);
    expect(dotWidth).toBe("5px");
  });

  test("navigation: links, current page and footer", async ({ page, isMobile }) => {
    test.skip(isMobile, "Desktop nav");
    await page.goto("/");
    await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Developers" }).click();
    await expect(page).toHaveURL(/\/developers$/);
    await expect(page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Developers" })).toHaveAttribute("aria-current", "page");
    await page.getByRole("navigation", { name: "Footer" }).getByRole("link", { name: "Data handling" }).click();
    await expect(page).toHaveURL(/\/data$/);
  });

  test("mobile menu opens, closes and navigates", async ({ page, isMobile }) => {
    test.skip(!isMobile, "Mobile menu");
    await page.goto("/");
    const menu = page.getByRole("button", { name: "Menu" });
    await expect(menu).toHaveAttribute("aria-expanded", "false");
    await menu.click();
    await expect(menu).toHaveAttribute("aria-expanded", "true");
    await page.locator("#mp").getByRole("link", { name: "Security" }).click();
    await expect(page).toHaveURL(/\/security$/);
    await expect(page.getByRole("button", { name: "Menu" })).toHaveAttribute("aria-expanded", "false");
  });

  test("code tabs switch with click and arrow keys, and copy", async ({ page, context, isMobile }) => {
    test.skip(isMobile, "Desktop interaction");
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.goto("/developers");
    const box = page.locator(".code").first();
    const python = box.getByRole("tab", { name: "Python" });
    await python.click();
    await expect(python).toHaveAttribute("aria-selected", "true");
    await expect(box.getByRole("tabpanel")).toContainText("from quellix import Quellix");
    await page.keyboard.press("ArrowRight");
    await expect(box.getByRole("tab", { name: "cURL" })).toBeFocused();
    await expect(box.getByRole("tabpanel")).toContainText("curl -X POST");
    await box.getByRole("button", { name: "Copy" }).click();
    await expect(box.getByRole("button", { name: "Copied" })).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toContain("curl -X POST");
  });

  test("a signed-in visitor still sees the landing, and Sign in goes to the app", async ({ page, context, isMobile }) => {
    test.skip(isMobile, "Desktop nav");
    await context.addCookies([DEMO_COOKIE]);
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(PAGES[0].h1);
    await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/app$/);
  });

  for (const p of PAGES) {
    test(`axe: ${p.name} has no serious violations`, async ({ page, isMobile }) => {
      test.skip(isMobile, "Runs on desktop");
      await page.goto(p.route);
      await page.waitForLoadState("networkidle");
      const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
      const serious = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
      expect(serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join(", ")}`)).toEqual([]);
    });
  }
});
