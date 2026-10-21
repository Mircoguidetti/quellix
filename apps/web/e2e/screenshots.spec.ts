import path from "node:path";
import type { Page, TestInfo } from "@playwright/test";
import { expect, signIn, test } from "./fixtures";

// Screenshots for the PR, at 1440 px (desktop project) and 390 px (mobile project).
const OUT = path.join(__dirname, "screenshots");

async function settle(page: Page) {
  await page.waitForLoadState("networkidle");
  await page.evaluate(() => document.fonts.ready);
  await expect(page.locator('[aria-busy="true"]')).toHaveCount(0);
}

async function shot(page: Page, info: TestInfo, name: string, fullPage = true) {
  await settle(page);
  await page.screenshot({ path: path.join(OUT, info.project.name, `${name}.png`), fullPage, caret: "hide" });
}

test.describe("screens", () => {
  test("landing", async ({ page }, info) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Stop watching every video before you pay for it.");
    if (info.project.name === "mobile") await page.getByRole("button", { name: "Menu" }).click();
    await expect(page.getByRole("link", { name: "Sign in" }).first()).toBeVisible();
    await shot(page, info, "01-landing");
  });

  test("sign in and create account", async ({ page }, info) => {
    await page.goto("/login");
    await expect(page.getByRole("button", { name: "Continue with Google" })).toBeVisible();
    await shot(page, info, "02-sign-in");
    // Inline validation: submit empty.
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page.getByText("Enter your email.")).toBeVisible();
    await page.goto("/signup");
    await expect(page.getByRole("heading", { name: "Create your account" })).toBeVisible();
    await shot(page, info, "03-create-account");
  });

  test("onboarding for a new account", async ({ page }, info) => {
    await page.goto("/signup");
    await page.getByLabel("Full name").fill("Sam Rivera");
    await page.getByLabel("Work email").fill(`sam+${info.project.name}-${Date.now()}@example.com`);
    await page.getByLabel("Password", { exact: true }).fill("collect2026");
    await page.getByRole("button", { name: "Create account" }).click();
    await page.waitForURL("**/onboarding");
    await expect(page.getByRole("heading", { name: "Name your organization" })).toBeVisible();
    await shot(page, info, "04-onboarding");
  });

  test("app screens", async ({ page }, info) => {
    await signIn(page);
    await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
    await expect(page.getByRole("link", { name: /Start reviewing \(\d+\)/ })).toBeVisible();
    await shot(page, info, "05-overview");

    if (info.project.name === "mobile") {
      await page.getByRole("button", { name: "Open navigation" }).click();
      await expect(page.getByRole("dialog").getByRole("link", { name: "Review" })).toBeVisible();
      await shot(page, info, "05b-navigation-drawer", false);
      await page.keyboard.press("Escape");
    }

    await page.goto("/app/review");
    if (info.project.name === "mobile") {
      await expect(page.getByRole("list", { name: "Videos waiting for review" })).toBeVisible();
      await shot(page, info, "06-review-queue", false);
      await page.getByRole("list", { name: "Videos waiting for review" }).getByRole("button").first().click();
    }
    await expect(page.getByRole("button", { name: "Accept" })).toBeVisible();
    await page.waitForFunction(() => {
      const v = document.querySelector("video");
      return !v || v.readyState >= 2;
    });
    await shot(page, info, "06-review", false);

    await page.goto("/app/videos");
    await expect(page.getByRole("table")).toBeVisible();
    await shot(page, info, "07-videos");

    await page.getByRole("combobox", { name: "Decision" }).click();
    await page.getByRole("option", { name: "Rejected" }).click();
    await page.waitForURL(/decision=reject/);
    await settle(page);
    await page.getByRole("table").getByRole("link").first().click();
    await page.waitForURL(/\/app\/videos\/[0-9a-f-]{36}$/);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await shot(page, info, "08-video-report");

    await page.goto("/app/rubrics");
    await page.getByRole("link", { name: /Load the dishwasher/ }).click();
    await expect(page.getByText("Live preview")).toBeVisible();
    await shot(page, info, "09-rubric-editor");

    await page.goto("/app/settings");
    await expect(page.getByRole("tab", { name: "API keys" })).toHaveAttribute("aria-selected", "true");
    await shot(page, info, "11-settings");
    await page.getByRole("button", { name: "Create key" }).click();
    await page.getByLabel("Name").fill(`Screenshot ${info.project.name}`);
    await page.getByRole("dialog").getByRole("button", { name: "Create key" }).click();
    await expect(page.getByTestId("one-time-secret")).toContainText("qx_live_");
    await shot(page, info, "10-dialog-api-key", false);
    await page.getByRole("button", { name: "I have copied it" }).click();

    await page.getByRole("tab", { name: "Team" }).click();
    await expect(page.getByText("Priya Raman")).toBeVisible();
    await shot(page, info, "11b-settings-team");

    await page.goto("/app/contests");
    await page.getByRole("table").getByRole("link").first().click();
    await expect(page.getByRole("button", { name: "Resolve" })).toBeVisible();
    await shot(page, info, "13-contest-detail");
    const report = await page.getByRole("link", { name: "Open the video report" }).getAttribute("href");
    const videoId = report!.split("/").pop()!;

    // The public page a contributor sees (issue #8: only reasons that caused the rejection).
    await page.goto(`/contest/${videoId}`);
    await expect(page.getByRole("heading", { name: "Contest a rejection" })).toBeVisible();
    await expect(page.getByText("sends to review")).toHaveCount(0);
    await shot(page, info, "12-contest-page");
  });
});
