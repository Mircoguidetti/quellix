import { test as base, expect, type Page } from "@playwright/test";

export const DEMO = { email: "demo@quellix.dev", password: "quellix-demo" };

/** Every test fails on a console error, an uncaught exception or a hydration warning. */
export const test = base.extend<{ consoleGuard: void }>({
  consoleGuard: [
    async ({ page }, use) => {
      const problems: string[] = [];
      page.on("console", (msg) => {
        const text = msg.text();
        if (msg.type() === "error" || /hydrat/i.test(text)) problems.push(`[console.${msg.type()}] ${text}`);
      });
      page.on("pageerror", (err) => problems.push(`[pageerror] ${err.message}`));
      await use();
      expect(problems, "console errors or hydration warnings").toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };

export async function signIn(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Work email").fill(DEMO.email);
  await page.getByLabel("Password", { exact: true }).fill(DEMO.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL("**/app");
}
