import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { DEMO, expect, signIn, test } from "./fixtures";

test.skip(({ isMobile }) => isMobile, "Keyboard and axe checks run on desktop.");

async function tabTo(page: Page, matches: (el: { text: string; label: string | null }) => boolean, max = 40) {
  for (let i = 0; i < max; i++) {
    await page.keyboard.press("Tab");
    const el = await page.evaluate(() => {
      const a = document.activeElement as HTMLElement | null;
      return { text: (a?.innerText ?? "").trim(), label: a?.getAttribute("aria-label") ?? null };
    });
    if (matches(el)) return;
  }
  throw new Error("Could not reach the element with the keyboard");
}

async function focusRingVisible(page: Page) {
  return page.evaluate(() => {
    const a = document.activeElement as HTMLElement;
    const s = getComputedStyle(a);
    const after = getComputedStyle(a, "::after");
    return (s.outlineStyle !== "none" && parseFloat(s.outlineWidth) > 0) || s.boxShadow !== "none" || after.boxShadow !== "none";
  });
}

test("keyboard only: sign in, open Review, accept a video, undo", async ({ page }) => {
  await page.goto("/login");
  // Tab from the top of the page into the email field.
  for (let i = 0; i < 20; i++) {
    await page.keyboard.press("Tab");
    if (await page.getByLabel("Work email").evaluate((el) => el === document.activeElement)) break;
  }
  await expect(page.getByLabel("Work email")).toBeFocused();
  expect(await focusRingVisible(page)).toBe(true);
  await page.keyboard.type(DEMO.email);
  await page.keyboard.press("Tab");
  await page.keyboard.type(DEMO.password);
  await page.keyboard.press("Enter");
  await page.waitForURL("**/app");

  // From the top of the app, Tab to the Review link and open it.
  await page.locator("body").focus();
  await tabTo(page, (e) => e.text.startsWith("Review"));
  expect(await focusRingVisible(page)).toBe(true);
  await page.keyboard.press("Enter");
  await page.waitForURL("**/app/review");
  await page.waitForLoadState("networkidle");
  const first = page.getByRole("list", { name: "Videos waiting for review" }).getByRole("button").first();
  const title = (await first.locator("span").first().innerText()).split("\n")[0];

  // ↓ / ↑ move between videos; J / K step through the flagged moments of the selected one.
  const queue = page.getByRole("list", { name: "Videos waiting for review" });
  await page.waitForLoadState("networkidle");
  await expect(queue.getByRole("button").first()).toHaveAttribute("aria-current", "true");
  await page.keyboard.press("ArrowDown");
  await expect(queue.getByRole("button").nth(1)).toHaveAttribute("aria-current", "true");
  await page.keyboard.press("ArrowUp");
  await expect(queue.getByRole("button").first()).toHaveAttribute("aria-current", "true");
  const moments = page.getByRole("region", { name: /Flagged moments/ }).getByRole("button");
  await expect(moments.first()).toHaveAttribute("aria-current", "true");
  if ((await moments.count()) > 1) {
    await page.keyboard.press("j");
    await expect(moments.nth(1)).toHaveAttribute("aria-current", "true");
    await page.keyboard.press("k");
    await expect(moments.first()).toHaveAttribute("aria-current", "true");
  }
  await page.keyboard.press("Enter");
  await page.keyboard.press("n");
  await expect(page.getByLabel(/^Note/)).toBeFocused();
  await page.keyboard.type("Checked on keyboard");
  await page.keyboard.press("Escape");
  await page.keyboard.press("a");
  await expect(page.getByText(`Accepted ${title}`)).toBeVisible();
  await expect(page.getByRole("list", { name: "Videos waiting for review" }).getByText(title, { exact: true })).toHaveCount(0);

  // Undo puts it back.
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(page.getByText(`${title} is back in the queue`)).toBeVisible();
  await expect(page.getByRole("list", { name: "Videos waiting for review" }).getByText(title, { exact: true })).toHaveCount(1);
});

for (const [name, path] of [
  ["sign in", "/login"],
  ["create account", "/signup"],
  ["overview", "/app"],
  ["review", "/app/review"],
  ["videos", "/app/videos"],
  ["rubrics", "/app/rubrics"],
  ["settings", "/app/settings"],
  ["contests", "/app/contests"],
  ["audit export", "/app/audit"],
] as const) {
  test(`axe: ${name} has no serious violations`, async ({ page }) => {
    if (path.startsWith("/app")) await signIn(page);
    await page.goto(path);
    await page.waitForLoadState("networkidle");
    await expect(page.locator('[aria-busy="true"]')).toHaveCount(0);
    const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
    const serious = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
    expect(serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join(", ")}`)).toEqual([]);
  });
}

test("dialogs trap focus and close with Escape", async ({ page }) => {
  await signIn(page);
  await page.goto("/app/settings?tab=webhooks");
  await page.getByRole("button", { name: "Add webhook" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(page.getByLabel("Endpoint URL")).toBeFocused();
  for (let i = 0; i < 6; i++) await page.keyboard.press("Tab");
  expect(await dialog.evaluate((d) => d.contains(document.activeElement))).toBe(true);
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
});

test("a wrong password shows a clear message and gives the button back", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Work email").fill(DEMO.email);
  await page.getByLabel("Password", { exact: true }).fill("not-the-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Email or password is incorrect." })).toBeVisible();
  await expect(page.getByRole("button", { name: "Sign in", exact: true })).toBeEnabled();
});
