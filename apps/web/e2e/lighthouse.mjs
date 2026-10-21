// Lighthouse accessibility scores for the pages the issue names (sign in, overview).
// Needs the demo server running: QUELLIX_DEMO=1 pnpm start -p 3100. Usage: pnpm lighthouse
import { execFileSync } from "node:child_process";
import { readFileSync, mkdirSync } from "node:fs";
import path from "node:path";

const BASE = process.env.LIGHTHOUSE_BASE ?? "http://localhost:3100";
const CHROME = process.env.CHROME_PATH ?? "/opt/pw-browsers/chromium";
const OUT = path.join(import.meta.dirname, ".results", "lighthouse");
// The demo user's session cookie (see src/lib/demo/seed.ts).
const COOKIE = "qx_demo_session=d3e0d3e0-0000-4000-8000-000000000001";
const PAGES = [
  ["sign-in", "/login", false],
  ["overview", "/app", true],
  ["review", "/app/review", true],
];
const MIN = 95;

mkdirSync(OUT, { recursive: true });
let failed = false;
for (const [name, url, auth] of PAGES) {
  const file = path.join(OUT, `${name}.json`);
  const args = [
    "-y", "lighthouse@12.8.2", BASE + url,
    "--only-categories=accessibility", "--output=json", `--output-path=${file}`, "--quiet",
    `--chrome-path=${CHROME}`, "--chrome-flags=--headless=new --no-sandbox",
  ];
  if (auth) args.push(`--extra-headers=${JSON.stringify({ Cookie: COOKIE })}`);
  execFileSync("npx", args, { stdio: "inherit", env: { ...process.env, CHROME_PATH: CHROME } });
  const report = JSON.parse(readFileSync(file, "utf8"));
  const score = Math.round(report.categories.accessibility.score * 100);
  const misses = Object.values(report.audits).filter((a) => a.score === 0 && a.scoreDisplayMode === "binary").map((a) => a.id);
  console.log(`${name.padEnd(10)} ${score}${misses.length ? `  failing: ${misses.join(", ")}` : ""}`);
  if (score < MIN) failed = true;
}
process.exit(failed ? 1 : 0);
