import path from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "./fixtures";

// The marketing site (issue #56): Home, Product, Security. The docs have their own spec (docs.spec.ts).
const OUT = path.join(__dirname, "screenshots");
const PAGES = [
  { route: "/", name: "home", title: "Ormes", h1: "Stop watching every video before you pay for it." },
  { route: "/product", name: "product", title: "Ormes Product", h1: "How Ormes decides" },
  { route: "/security", name: "security", title: "Ormes Security", h1: "How your videos are handled" },
];
const DEMO_COOKIE = { name: "qx_demo_session", value: "d3e0d3e0-0000-4000-8000-000000000001", url: "http://localhost:3100" };

test.describe("marketing site", () => {
  for (const p of PAGES) {
    test(`${p.name}: renders, metadata, no overflow, no console errors, screenshot`, async ({ page }, info) => {
      const errors: string[] = [];
      page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
      page.on("pageerror", (e) => errors.push(String(e)));
      await page.goto(p.route);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(p.h1);
      await expect(page).toHaveTitle(p.title);
      // No footage is shown yet, so no footage credit (issue #25 add-on).
      await expect(page.getByText("Demo footage")).toHaveCount(0);
      await expect(page.locator('meta[property="og:image"]')).toHaveAttribute("content", /opengraph-image/);
      await page.waitForLoadState("networkidle");
      await page.evaluate(() => document.fonts.ready);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(page.viewportSize()!.width);
      await page.screenshot({ path: path.join(OUT, info.project.name, `site-${p.name}.png`), fullPage: true, caret: "hide" });
      expect(errors).toEqual([]);
    });
  }

  test("only Home has a hero; Product and Security start with a compact intro and in-page nav", async ({ page }) => {
    for (const p of PAGES.slice(1)) {
      await page.goto(p.route);
      const nav = page.getByRole("navigation", { name: "On this page" });
      await expect(nav).toBeVisible();
      const first = nav.getByRole("link").first();
      const target = await first.getAttribute("href");
      await expect(page.locator(target!)).toHaveCount(1);
    }
  });

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

  test("/developers redirects to the docs", async ({ page }) => {
    await page.goto("/developers");
    await expect(page).toHaveURL(/\/docs$/);
  });

  test("navigation: links, current page and footer", async ({ page, isMobile }) => {
    test.skip(isMobile, "Desktop nav");
    await page.goto("/");
    const main = page.getByRole("navigation", { name: "Main" });
    await expect(main.getByRole("link")).toHaveText(["Product", "Security", "Docs", "Sign in", "Start a pilot"]);
    await main.getByRole("link", { name: "Security" }).click();
    await expect(page).toHaveURL(/\/security$/);
    await expect(main.getByRole("link", { name: "Security" })).toHaveAttribute("aria-current", "page");
    const footer = page.getByRole("navigation", { name: "Footer" });
    await expect(footer.getByRole("link")).toHaveText(["Product", "Security", "Docs", "Data handling", "DPA"]);
    await footer.getByRole("link", { name: "Data handling" }).click();
    await expect(page).toHaveURL(/\/data$/);
  });

  test("mobile menu opens, closes with Escape and navigates", async ({ page, isMobile }) => {
    test.skip(!isMobile, "Mobile menu");
    await page.goto("/");
    const open = page.getByRole("button", { name: "Open menu" });
    await expect(open).toHaveAttribute("aria-expanded", "false");
    await open.click();
    await expect(page.getByRole("button", { name: "Close menu" })).toHaveAttribute("aria-expanded", "true");
    await page.keyboard.press("Escape");
    await expect(page.getByRole("button", { name: "Open menu" })).toHaveAttribute("aria-expanded", "false");
    await page.getByRole("button", { name: "Open menu" }).click();
    await page.locator("#site-menu").getByRole("link", { name: "Product" }).click();
    await expect(page).toHaveURL(/\/product$/);
    await expect(page.getByRole("button", { name: "Open menu" })).toHaveAttribute("aria-expanded", "false");
  });

  test("with reduced motion every visual shows its final state", async ({ page }) => {
    // The config runs with reducedMotion: "reduce".
    await page.goto("/");
    const flow = page.locator("#flow");
    await expect(flow.getByText("8,000", { exact: true })).toBeVisible();
    await expect(flow.getByText("75 h", { exact: true })).toBeVisible();
    await page.goto("/product");
    await expect(page.getByText("Saving creates v4")).toBeVisible();
  });

  test("Home: nine sections, one buyer question each, in order (issue #69)", async ({ page }) => {
    await page.goto("/");
    // Section shots: the sticky header would cover the top of each section.
    await page.addStyleTag({ content: "header { position: static !important; }" });
    const ids = await page.locator("main > section[id]").evaluateAll((els) => els.map((e) => e.id));
    expect(ids).toEqual(["top", "problem", "flow", "checks", "why", "privacy", "api", "pilot", "faq", "start"]);
    // The review console and the old phone moved off Home; "What Ormes doesn't do" and pricing are gone.
    await expect(page.getByText("What Ormes doesn’t do.")).toHaveCount(0);
    await expect(page.getByText("Pay per hour of video checked.")).toHaveCount(0);
    await expect(page.getByRole("img", { name: /The Ormes review screen/ })).toHaveCount(0);
    // Problem sources are cited.
    await expect(page.locator("#problem").getByRole("link", { name: /Market Xcel/ })).toBeVisible();
    await expect(page.locator("#problem").getByRole("link", { name: /Unidata/ })).toBeVisible();
    // Why Ormes, at rest: the reviewer's verdict tomorrow vs Ormes's reason and the contributor's fix.
    const why = page.locator("#why");
    await expect(why.getByText("tomorrow")).toBeVisible();
    await expect(why.getByText("Your video was rejected.")).toBeVisible();
    await expect(why.getByText("Hold the phone lower and record again.")).toBeVisible();
    await expect(why.getByRole("link", { name: "How it works" })).toHaveAttribute("href", "/product");
    // FAQ keeps the five questions and adds the sixth.
    await expect(page.locator("#faq details")).toHaveCount(6);
    await expect(page.getByText("Can Ormes reject a good video?")).toBeVisible();
  });

  test("Product: the review section shows the console and its shortcuts", async ({ page }) => {
    await page.goto("/product");
    const review = page.locator("#review");
    await expect(review.getByRole("img", { name: /The Ormes review screen/ })).toBeVisible();
    await expect(review.getByLabel("Review shortcuts")).toContainText("Replay the current moment");
  });

  test("Product: hovering a check lights its path to an outcome", async ({ page, isMobile }) => {
    test.skip(isMobile, "Hover");
    await page.goto("/product");
    const diagram = page.locator("#decision");
    await diagram.getByRole("button", { name: "Privacy" }).hover();
    await expect(diagram.getByText("privacy.document")).toBeVisible();
    await diagram.getByRole("button", { name: "Hands" }).hover();
    await expect(diagram.getByText("hands_visible.below_min")).toBeVisible();
  });

  test("Product: the rubric preview counts the decisions that would change", async ({ page }) => {
    await page.goto("/product");
    const rubrics = page.locator("#rubrics");
    await expect(rubrics.getByText(/1\s+of 178 decisions would change/)).toBeVisible();
    await rubrics.getByLabel("Hands, while handling objects").fill("80");
    await expect(rubrics.getByText("Nothing to save")).toBeVisible();
    await rubrics.getByLabel("Hands, while handling objects").fill("90");
    await expect(rubrics.getByText(/11\s+of 178 decisions would change/)).toBeVisible();
  });

  test("Security: the training switch explains the opt-in", async ({ page }) => {
    await page.goto("/security");
    const sw = page.getByRole("switch", { name: /Training on your videos/ });
    await expect(sw).toHaveAttribute("aria-checked", "false");
    await sw.click();
    await expect(sw).toHaveAttribute("aria-checked", "true");
    await expect(page.getByText("Your videos train Ormes’s own models only.")).toBeVisible();
  });

  test("a signed-in visitor still sees the landing, and Sign in goes to the app", async ({ page, context, isMobile }) => {
    test.skip(isMobile, "Desktop nav");
    await context.addCookies([DEMO_COOKIE]);
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(PAGES[0].h1);
    await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/app$/);
  });

  test("axe: docs has no serious violations (light content, dark footer)", async ({ page, isMobile }) => {
    test.skip(isMobile, "Runs on desktop");
    await page.goto("/docs/quickstart");
    await page.waitForLoadState("networkidle");
    const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
    const serious = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
    expect(serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join(", ")}`)).toEqual([]);
  });

  test("surfaces: dark accents on Home, light everywhere else (issue #69)", async ({ page }) => {
    const surface = (sel: string) => page.locator(sel).first().evaluate((el) => el.closest(".surface-dark, .surface-light")?.className.match(/surface-(dark|light)/)?.[1]);
    await page.goto("/");
    expect(await surface("#top")).toBe("dark");
    for (const id of ["problem", "flow", "checks", "privacy", "api", "pilot", "faq"]) expect(await surface(`#${id}`), id).toBe("light");
    expect(await surface("#why")).toBe("dark");
    expect(await surface("#start")).toBe("dark");
    expect(await surface("footer")).toBe("dark");
    for (const route of ["/product", "/security"]) {
      await page.goto(route);
      expect(await surface("main section"), route).toBe("light");
      expect(await surface("footer"), route).toBe("dark");
    }
    // The hero has no trust row any more, and the clip sits in a contained card.
    await page.goto("/");
    await expect(page.getByText("Videos deleted after analysis")).toHaveCount(0);
  });

  test("screenshots: every Home section, and the other pages above the fold", async ({ page }, info) => {
    const dir = path.join(OUT, info.project.name, "sections");
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: path.join(dir, "home-00-above-the-fold.jpg"), type: "jpeg", quality: 72 });
    // Section shots: the sticky header would cover the top of each section.
    await page.addStyleTag({ content: "header { position: static !important; }" });
    const ids = await page.locator("main > section[id]").evaluateAll((els) => els.map((e) => e.id));
    for (const [i, id] of ids.entries()) {
      await page.locator(`#${id}`).screenshot({ path: path.join(dir, `home-${String(i + 1).padStart(2, "0")}-${id}.jpg`), type: "jpeg", quality: 72 });
    }
    for (const [name, route] of [["product", "/product"], ["security", "/security"], ["docs", "/docs"]]) {
      await page.goto(route);
      await page.waitForLoadState("networkidle");
      await page.evaluate(() => document.fonts.ready);
      await page.screenshot({ path: path.join(dir, `${name}-above-the-fold.jpg`), type: "jpeg", quality: 72 });
    }
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
