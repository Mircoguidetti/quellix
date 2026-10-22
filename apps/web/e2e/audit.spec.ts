import path from "node:path";
import { expect, signIn, test } from "./fixtures";

const OUT = path.join(__dirname, "screenshots");

test.describe("audit export", () => {
  test("shows the report per rubric version, filters it and downloads CSV and JSON", async ({ page }, info) => {
    await signIn(page);
    await page.goto("/app");
    const nav = info.project.name === "mobile" ? null : page.getByRole("navigation").getByRole("link", { name: "Audit" });
    if (nav) {
      await nav.click();
      await page.waitForURL("**/app/audit");
    } else {
      await page.goto("/app/audit");
    }
    await expect(page.getByRole("heading", { level: 1, name: "Audit export" })).toBeVisible();

    // The demo has three rubrics; at least one version shows checks, rejection codes and overrides.
    const cards = page.locator('[aria-labelledby^="audit-"]');
    await expect(cards.first()).toBeVisible();
    expect(await cards.count()).toBeGreaterThanOrEqual(3);
    await expect(page.getByRole("region", { name: /^Checks, / }).first().getByRole("cell", { name: "Technical quality" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Rejection codes" }).first().getByRole("table")).toBeVisible();
    await expect(page.getByRole("region", { name: /^Reviewer overrides, / }).getByText(/^Spot check:/).locator("visible=true").first()).toBeVisible();

    await page.waitForLoadState("networkidle");
    await page.evaluate(() => document.fonts.ready);
    // Every table fits its box at both widths: nothing to scroll sideways.
    const overflowing = await page.evaluate(() =>
      [...document.querySelectorAll("main .overflow-x-auto")]
        .filter((el) => el.scrollWidth > el.clientWidth + 1)
        .map((el) => `${el.closest("section")?.getAttribute("aria-label")}: ${el.scrollWidth} > ${el.clientWidth}`),
    );
    expect(overflowing).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    if (!info.project.use.hasTouch) await page.mouse.move(0, 0);
    await page.screenshot({ path: path.join(OUT, info.project.name, "14-audit.png"), fullPage: true, caret: "hide" });

    // Filter to one rubric and version: the page and the export links follow.
    await page.getByLabel("Rubric").selectOption({ label: "Load the dishwasher" });
    const version = page.getByLabel("Version");
    await expect(version).toBeEnabled();
    const versions = await version.locator("option").allTextContents();
    await version.selectOption({ label: versions[1] });
    await page.getByRole("button", { name: "Apply" }).click();
    await page.waitForURL(/rubric_id=.*&version=\d+/);
    await expect(cards).toHaveCount(1);
    await expect(cards.first().getByText(versions[1], { exact: true })).toBeVisible();

    const csvHref = await page.getByRole("link", { name: "Download CSV" }).getAttribute("href");
    const params = new URL(csvHref!, "http://x").searchParams;
    expect(new URL(csvHref!, "http://x").pathname).toBe("/app/audit/export");
    expect(params.get("format")).toBe("csv");
    expect(params.get("rubric_id")).toMatch(/^[0-9a-f-]{36}$/);
    expect(params.get("version")).toBe(versions[1].slice(1));
    const csv = await page.request.get(csvHref!);
    expect(csv.status()).toBe(200);
    expect(csv.headers()["content-type"]).toBe("text/csv; charset=utf-8");
    expect(csv.headers()["content-disposition"]).toMatch(/^attachment; filename="audit_\d{4}-\d{2}-\d{2}_\d{4}-\d{2}-\d{2}\.csv"$/);
    const text = await csv.text();
    expect(text.split("\r\n")[0]).toBe("rubric_id,rubric_name,rubric_version,section,key,metric,value");
    expect(text).toContain(",Load the dishwasher,");

    const json = await page.request.get((await page.getByRole("link", { name: "Download JSON" }).getAttribute("href"))!);
    const report = await json.json();
    expect(report.object).toBe("audit_report");
    expect(report.groups).toHaveLength(1);
    expect(report.groups[0].rubric.name).toBe("Load the dishwasher");
  });

  test("explains an invalid window instead of failing", async ({ page }) => {
    await signIn(page);
    await page.goto("/app/audit?from=2026-10-05&to=2026-10-01");
    await expect(page.getByRole("alert").filter({ hasText: "from must be on or before to" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Download CSV" })).toHaveCount(0);
  });

  test("the export needs a session", async ({ request }) => {
    const res = await request.get("/app/audit/export?format=csv", { maxRedirects: 0 });
    expect([302, 303, 307]).toContain(res.status());
    expect(res.headers().location).toContain("/login");
  });
});
