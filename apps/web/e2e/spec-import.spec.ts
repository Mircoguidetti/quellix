import { KITCHEN_SPEC } from "../src/lib/spec-import/fixtures";
import { expect, signIn, test } from "./fixtures";
import { pdfWith } from "./pdf";

test.describe("spec importer (issue #28)", () => {
  test.beforeEach(async ({ page }) => signIn(page));

  test("drafts a cited rubric from pasted guidelines and saves it", async ({ page }) => {
    await page.goto("/app/rubrics/import");
    await expect(page.getByRole("switch", { name: /Gemini/ })).toBeDisabled();
    await page.getByLabel("The lab's guidelines").fill(KITCHEN_SPEC);
    await page.getByRole("button", { name: "Draft the rubric" }).click();

    await expect(page.getByRole("heading", { name: "Where each value comes from" })).toBeVisible();
    const hands = page.getByRole("listitem").filter({ hasText: "Hands: minimum visible" });
    await expect(hands).toContainText("90%");
    await expect(hands).toContainText(/line \d+/);
    await expect(page.getByText("Orientation is not checked yet.")).toBeVisible();
    await expect(page.getByText("Idle time is not measured yet.")).toBeVisible();

    await page.getByRole("button", { name: "Create rubric" }).click();
    const confirm = page.getByRole("dialog");
    if (await confirm.isVisible().catch(() => false)) await confirm.getByRole("button", { name: /Save|Create/ }).last().click();
    await page.waitForURL(/\/app\/rubrics\/(?!import|new)[^/]+$/);
  });

  test("reads a PDF in the browser", async ({ page }) => {
    await page.goto("/app/rubrics/import");
    await page.waitForLoadState("networkidle"); // a file picked before hydration has no handler yet
    let posted = false;
    page.on("request", (r) => {
      if (r.method() === "POST" && (r.postData() ?? "").includes("%PDF")) posted = true;
    });
    await page.getByLabel("Spec file (PDF or text)").setInputFiles({
      name: "spec.pdf",
      mimeType: "application/pdf",
      buffer: pdfWith(["Factory assembly guidelines", "Both hands must be visible at least 85% of the time while manipulating parts.", "Minimum 24 fps."]),
    });
    await expect(page.getByLabel("The lab's guidelines")).toHaveValue(/at least 85% of the time/);
    expect(posted).toBe(false);
    await page.getByRole("button", { name: "Draft the rubric" }).click();
    await expect(page.getByRole("listitem").filter({ hasText: "Hands: minimum visible" })).toContainText("85%");
    await expect(page.getByRole("listitem").filter({ hasText: "Minimum frame rate" })).toContainText("24 fps");
  });

  test("new rubric can start from the library", async ({ page }) => {
    await page.goto("/app/rubrics/new");
    await page.getByRole("link", { name: /Common public egocentric spec/ }).click();
    await page.waitForURL(/template=common-public-spec/);
    await expect(page.getByText("Landscape orientation is not checked yet.")).toBeVisible();
    await expect(page.getByLabel("Name")).toHaveValue("Common egocentric spec");
  });
});
