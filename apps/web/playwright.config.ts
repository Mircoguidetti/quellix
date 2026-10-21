import { defineConfig, devices } from "@playwright/test";
import path from "node:path";

const PORT = Number(process.env.E2E_PORT ?? 3100);
export const DEMO_VIDEO = path.join(__dirname, "e2e", ".cache", "demo-clip-v2.webm");
// The environment ships Chromium here; elsewhere Playwright's own download is used.
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_PATH ?? (process.env.PLAYWRIGHT_BROWSERS_PATH ? "/opt/pw-browsers/chromium" : undefined);

/**
 * End-to-end tests and screenshots run against `next start` in demo mode (seeded in-memory data,
 * no Supabase). Run `pnpm build` first, then `pnpm e2e`.
 */
export default defineConfig({
  testDir: "e2e",
  outputDir: "e2e/.results",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  globalSetup: "./e2e/global-setup.ts",
  use: {
    baseURL: `http://localhost:${PORT}`,
    launchOptions: { executablePath },
    trace: "retain-on-failure",
    colorScheme: "light",
    reducedMotion: "reduce",
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 } },
    { name: "mobile", use: { ...devices["Pixel 7"], viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true } },
  ],
  webServer: {
    command: `pnpm start -p ${PORT}`,
    port: PORT,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: { QUELLIX_DEMO: "1", QUELLIX_DEMO_VIDEO: DEMO_VIDEO, NEXT_PUBLIC_SITE_URL: `http://localhost:${PORT}` },
  },
});
