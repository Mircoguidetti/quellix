import path from "node:path";
import { expect, test } from "./fixtures";

// The documentation (issue #56): light theme, sidebar, On this page, Previous / Next, code tabs.
const OUT = path.join(__dirname, "screenshots");
const PAGES = [
  { route: "/docs", name: "index", h1: "Get started", title: "Docs · Ormes", sidebar: "Get started", prev: null, next: "Quickstart" },
  { route: "/docs/quickstart", name: "quickstart", h1: "Quickstart", title: "Quickstart · Ormes", sidebar: "Quickstart", prev: "Get started", next: "Webhooks" },
  { route: "/docs/webhooks", name: "webhooks", h1: "Webhooks", title: "Webhooks · Ormes", sidebar: "Webhooks", prev: "Quickstart", next: "Rubrics" },
  { route: "/docs/rubrics", name: "rubrics", h1: "Rubrics", title: "Rubrics · Ormes", sidebar: "Rubrics", prev: "Webhooks", next: "Decisions" },
  { route: "/docs/decisions", name: "decisions", h1: "Decisions", title: "Decisions · Ormes", sidebar: "Decisions", prev: "Rubrics", next: "Review and contests" },
  { route: "/docs/review", name: "review", h1: "Review and contests", title: "Review and contests · Ormes", sidebar: "Review and contests", prev: "Decisions", next: "API reference" },
  { route: "/docs/reference", name: "reference", h1: "API reference", title: "API reference · Ormes", sidebar: "API reference", prev: "Review and contests", next: null },
];

test.describe("docs", () => {
  for (const p of PAGES) {
    test(`${p.name}: renders, current item, prev/next, no overflow, screenshot`, async ({ page, isMobile }, info) => {
      await page.goto(p.route);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(p.h1);
      await expect(page).toHaveTitle(p.title);

      // The sidebar marks the current page (inside the drawer on mobile).
      if (isMobile) {
        await page.getByRole("button", { name: "Documentation menu" }).click();
        await expect(page.getByRole("dialog").getByRole("link", { name: p.sidebar, exact: true })).toHaveAttribute("aria-current", "page");
        await page.keyboard.press("Escape");
        await expect(page.getByRole("dialog")).toBeHidden();
      } else {
        const sidebar = page.getByRole("navigation", { name: "Documentation" });
        await expect(sidebar.getByRole("link", { name: p.sidebar, exact: true })).toHaveAttribute("aria-current", "page");
        await expect(sidebar.locator('[aria-current="page"]')).toHaveCount(1);
      }

      const pager = page.getByRole("navigation", { name: "Previous and next page" });
      if (p.prev) await expect(pager.locator('a[rel="prev"]')).toContainText(p.prev);
      else await expect(pager.locator('a[rel="prev"]')).toHaveCount(0);
      if (p.next) await expect(pager.locator('a[rel="next"]')).toContainText(p.next);
      else await expect(pager.locator('a[rel="next"]')).toHaveCount(0);

      // "On this page" only on wide screens.
      const toc = page.getByRole("navigation", { name: "On this page" });
      if (p.name === "index") await expect(toc).toHaveCount(0);
      else if (isMobile) await expect(toc).toBeHidden();
      else await expect(toc).toBeVisible();

      await page.waitForLoadState("networkidle");
      await page.evaluate(() => document.fonts.ready);
      await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(page.viewportSize()!.width);
      await page.screenshot({ path: path.join(OUT, info.project.name, `docs-${p.name}.png`), fullPage: true, caret: "hide" });
    });
  }

  test("header: docs is current, links to the site", async ({ page, isMobile }) => {
    test.skip(isMobile, "Desktop header");
    await page.goto("/docs/quickstart");
    const main = page.getByRole("navigation", { name: "Main" });
    await expect(main.getByRole("link", { name: "Docs" })).toHaveAttribute("aria-current", "page");
    await expect(main.getByRole("link", { name: "Product" })).toHaveAttribute("href", "/product");
    await expect(main.getByRole("link", { name: "Start a pilot" })).toHaveAttribute("href", "/signup");
    await expect(page.getByRole("navigation", { name: "Footer" }).getByRole("link", { name: "DPA" })).toHaveAttribute("href", "/dpa");
  });

  test("code blocks: copy, and the language choice applies to every block", async ({ page, context, isMobile }) => {
    test.skip(isMobile, "Desktop interaction");
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.goto("/docs/quickstart");

    const blocks = page.locator("[data-code-block]");
    const rubric = blocks.filter({ hasText: "rubrics.create" }).first();
    await rubric.getByRole("tab", { name: "Python" }).click();
    await expect(rubric.getByRole("tab", { name: "Python" })).toHaveAttribute("aria-selected", "true");
    await expect(rubric.getByRole("tabpanel")).toContainText("ormes.rubrics.create({");

    // Another block follows the same choice.
    const upload = blocks.filter({ hasText: "videos.upload" }).first();
    await expect(upload.getByRole("tab", { name: "Python" })).toHaveAttribute("aria-selected", "true");
    await expect(upload.getByRole("tabpanel")).toContainText("rubric_id=rubric.id");

    // Arrow keys move between tabs.
    await upload.getByRole("tab", { name: "Python" }).press("ArrowRight");
    await expect(upload.getByRole("tab", { name: "cURL" })).toHaveAttribute("aria-selected", "true");
    await expect(upload.getByRole("tab", { name: "cURL" })).toBeFocused();

    await upload.getByRole("button", { name: "Copy code" }).click();
    await expect(upload.getByRole("button", { name: "Copied" })).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toContain('curl -X POST "$ORMES_BASE_URL/videos"');

    // The choice survives a navigation.
    await page.goto("/docs/webhooks");
    await expect(page.locator("[data-code-block]").filter({ hasText: "constructEvent" }).first().getByRole("tab", { name: "TypeScript" })).toHaveAttribute("aria-selected", "true");
    await page.goto("/docs/review");
    await expect(page.locator("[data-code-block]").first().getByRole("tab", { name: "cURL" })).toHaveAttribute("aria-selected", "true");
  });

  test("On this page highlights the section in view", async ({ page, isMobile }) => {
    test.skip(isMobile, "The rail is hidden on mobile");
    await page.goto("/docs/decisions");
    const toc = page.getByRole("navigation", { name: "On this page" });
    await expect(toc.getByRole("link", { name: "The rule" })).toHaveAttribute("aria-current", "location");
    await page.evaluate(() => document.getElementById("measurements")!.scrollIntoView({ block: "start" }));
    await expect(toc.getByRole("link", { name: "Measurements" })).toHaveAttribute("aria-current", "location");
  });

  test("mobile drawer opens, closes with Escape and navigates", async ({ page, isMobile }) => {
    test.skip(!isMobile, "Mobile drawer");
    await page.goto("/docs");
    // While the drawer is open the rest of the page is hidden from assistive tech, so find the button by label.
    const menu = page.locator('button[aria-label="Documentation menu"]');
    await expect(menu).toHaveAttribute("aria-expanded", "false");
    await menu.click();
    await expect(menu).toHaveAttribute("aria-expanded", "true");
    const drawer = page.getByRole("dialog");
    await expect(drawer.getByRole("navigation", { name: "Documentation" })).toBeVisible();
    await page.screenshot({ path: path.join(OUT, "mobile", "docs-drawer.png"), caret: "hide" });
    await page.keyboard.press("Escape");
    await expect(drawer).toBeHidden();
    await expect(menu).toHaveAttribute("aria-expanded", "false");

    await menu.click();
    await page.getByRole("dialog").getByRole("link", { name: "Webhooks" }).click();
    await expect(page).toHaveURL(/\/docs\/webhooks$/);
    await expect(page.getByRole("dialog")).toBeHidden();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Webhooks");
  });
});
