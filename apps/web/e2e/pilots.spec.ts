import path from "node:path";
import { readFileSync } from "node:fs";
import AxeBuilder from "@axe-core/playwright";
import type { Page, TestInfo } from "@playwright/test";
import { DEMO_VIDEO } from "../playwright.config";
import { expect, signIn, test } from "./fixtures";

const OUT = path.join(__dirname, "screenshots");

async function shot(page: Page, info: TestInfo, name: string) {
  await page.waitForLoadState("networkidle");
  await page.evaluate(() => document.fonts.ready);
  if (!info.project.use.hasTouch) await page.mouse.move(0, 0);
  await page.screenshot({ path: path.join(OUT, info.project.name, `${name}.png`), fullPage: true, caret: "hide" });
}

async function noSidewaysScroll(page: Page) {
  // Against the configured width: a too-wide element can widen the mobile layout viewport itself.
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(page.viewportSize()!.width);
}

test.describe("shadow pilots", () => {
  test("the report: verdict against the agreed criteria, evidence, exports", async ({ page }, info) => {
    await signIn(page);
    await page.goto("/app/pilots");
    await expect(page.getByRole("heading", { level: 1, name: "Pilots" })).toBeVisible();
    await page.getByRole("link", { name: "October batch, shadow mode" }).click();
    await page.waitForURL(/\/app\/pilots\/[0-9a-f-]{36}$/);

    await expect(page.getByRole("heading", { level: 2, name: /^(Pass|Fail|Not measurable)$/ })).toBeVisible();
    await expect(page.getByRole("list", { name: "Success criteria, agreed before the run" }).getByRole("listitem")).toHaveCount(3);
    await expect(page.getByText("64 of 64 videos analysed")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Ormes vs your reviewers" })).toBeVisible();
    await expect(page.getByRole("heading", { name: /Against the lab/ })).toBeVisible();
    const disagreements = page.getByRole("list", { name: "Disagreements" }).getByRole("listitem").filter({ has: page.getByRole("link") });
    expect(await disagreements.count()).toBeGreaterThan(0);
    await noSidewaysScroll(page);
    await shot(page, info, "16-pilot-report");

    if (info.project.name === "desktop") {
      const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
      expect(axe.violations.filter((v) => v.impact === "serious" || v.impact === "critical")).toEqual([]);
    }

    const pdf = await page.request.get((await page.getByRole("link", { name: "Download PDF" }).getAttribute("href"))!);
    expect(pdf.headers()["content-type"]).toBe("application/pdf");
    expect(pdf.headers()["content-disposition"]).toBe('attachment; filename="ormes-pilot-october-batch-shadow-mode.pdf"');
    expect((await pdf.body()).subarray(0, 5).toString()).toBe("%PDF-");

    const csv = await page.request.get((await page.getByRole("link", { name: "Download CSV" }).getAttribute("href"))!);
    expect(csv.headers()["content-type"]).toBe("text/csv; charset=utf-8");
    const lines = (await csv.text()).trimEnd().split("\r\n");
    expect(lines[0]).toBe("external_id,reviewer_decision,ormes_decision,outcome,lab_outcome,reviewer_minutes,duration_s,reasons,moments_to_inspect");
    expect(lines).toHaveLength(65);

    // A shadow video never reaches a contributor: no contest page, even for a rejection.
    const falseReject = disagreements.filter({ hasText: "false reject" }).first();
    if (await falseReject.count()) {
      const href = await falseReject.getByRole("link").getAttribute("href");
      await page.goto(`/contest/${href!.split("/").pop()}`);
      await expect(page.getByRole("heading", { level: 1, name: "Nothing to contest" })).toBeVisible();
    }
  });

  test("import a judged batch: criteria first, CSV and files, then the run", async ({ page }, info) => {
    await signIn(page);
    await page.goto("/app/pilots");
    await page.getByRole("link", { name: "New pilot" }).first().click();
    await expect(page.getByRole("heading", { level: 1, name: "New shadow pilot" })).toBeVisible();

    const name = `E2E pilot ${info.project.name}`;
    await page.getByLabel("Name").fill(name);
    await expect(page.getByLabel("Criterion 1", { exact: true })).toHaveValue("review_minutes_change");
    await expect(page.getByLabel("Change (%)")).toHaveValue("-40");
    await page.getByRole("button", { name: "Add criterion" }).click();
    await expect(page.getByLabel("Criterion 3", { exact: true })).toHaveValue("false_reject_rate");

    // A CSV with a mistake first: the problem is named by line, and nothing can start.
    await page.getByLabel("Reviewers' decisions CSV").setInputFiles({ name: "bad.csv", mimeType: "text/csv", buffer: Buffer.from("external_id,reviewer_decision\nw_1,maybe\n") });
    await expect(page.getByRole("alert").filter({ hasText: "Line 2: reviewer_decision must be accept or reject." })).toBeVisible();
    await expect(page.getByRole("button", { name: /Start the pilot/ })).toBeDisabled();

    const csv = [
      "external_id,reviewer_decision,reviewer_minutes,lab_outcome,contributor_ref,source_url",
      "w_1,accept,2,accept,c_1,",
      "w_2,reject,4,reject,c_2,",
      "w_3,accept,3,,c_3,https://storage.example.com/batch/w_3.mp4?sig=abc",
      "w_4,accept,,,c_4,",
    ].join("\n");
    await page.getByLabel("Reviewers' decisions CSV").setInputFiles({ name: "judged.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
    await expect(page.getByText("judged.csv: 4 rows")).toBeVisible();

    const clip = readFileSync(DEMO_VIDEO);
    await page.getByLabel("Video files").setInputFiles([
      { name: "w_1.webm", mimeType: "video/webm", buffer: clip },
      { name: "w_2.webm", mimeType: "video/webm", buffer: clip },
      { name: "unrelated.webm", mimeType: "video/webm", buffer: clip },
    ]);
    const matching = page.getByRole("list", { name: "Matching" });
    await expect(matching).toContainText("2 of 4 rows matched to a file, 1 fetched from their URL.");
    await expect(matching).toContainText("1 row without a file or URL (shown as missing in the report): w_4");
    await expect(matching).toContainText("1 file not in the CSV (ignored): unrelated.webm");
    await noSidewaysScroll(page);
    await shot(page, info, "15-pilot-new");

    await page.getByRole("button", { name: "Start the pilot (3 videos)" }).click();
    await page.waitForURL(/\/app\/pilots\/[0-9a-f-]{36}$/, { timeout: 30_000 });
    await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
    // The demo worker decides each video a few seconds after it is queued; the page refreshes itself.
    await expect(page.getByText(/^3 of 4 videos analysed · 1 without a file\./)).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole("heading", { level: 2, name: /^(Pass|Fail|Not measurable)$/ })).toBeVisible();

    // The pilot's videos stay out of the customer's video list.
    await page.goto("/app/pilots");
    await expect(page.getByRole("row").filter({ hasText: name })).toContainText("3 / 4");
  });
});
