// Lighthouse scores: accessibility for the app pages (#15, min 95), performance and accessibility
// for the marketing home (#35, min 90). Needs the demo server: QUELLIX_DEMO=1 pnpm start -p 3100.
// Usage: pnpm lighthouse
import { execFileSync } from "node:child_process";
import { readFileSync, mkdirSync } from "node:fs";
import path from "node:path";

const BASE = process.env.LIGHTHOUSE_BASE ?? "http://localhost:3100";
const CHROME = process.env.CHROME_PATH ?? "/opt/pw-browsers/chromium";
const OUT = path.join(import.meta.dirname, ".results", "lighthouse");
// The demo user's session cookie (see src/lib/demo/seed.ts).
const COOKIE = "qx_demo_session=d3e0d3e0-0000-4000-8000-000000000001";
const PAGES = [
  { name: "home", url: "/", categories: ["performance", "accessibility"], min: 90 },
  { name: "sign-in", url: "/login", categories: ["accessibility"], min: 95 },
  { name: "overview", url: "/app", auth: true, categories: ["accessibility"], min: 95 },
  { name: "review", url: "/app/review", auth: true, categories: ["accessibility"], min: 95 },
];

mkdirSync(OUT, { recursive: true });
let failed = false;
for (const page of PAGES) {
  const file = path.join(OUT, `${page.name}.json`);
  const args = [
    "-y", "lighthouse@12.8.2", BASE + page.url,
    `--only-categories=${page.categories.join(",")}`, "--output=json", `--output-path=${file}`, "--quiet",
    `--chrome-path=${CHROME}`, "--chrome-flags=--headless=new --no-sandbox",
  ];
  if (page.auth) args.push(`--extra-headers=${JSON.stringify({ Cookie: COOKIE })}`);
  execFileSync("npx", args, { stdio: "inherit", env: { ...process.env, CHROME_PATH: CHROME } });
  const report = JSON.parse(readFileSync(file, "utf8"));
  const scores = page.categories.map((c) => {
    const score = Math.round(report.categories[c].score * 100);
    if (score < page.min) failed = true;
    return `${c} ${score}`;
  });
  console.log(`${page.name.padEnd(10)} ${scores.join("  ")}`);
}
process.exit(failed ? 1 : 0);
