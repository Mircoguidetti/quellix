import { spawn } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { chromium, type FullConfig } from "@playwright/test";

const OUT = path.join(__dirname, ".cache", "demo-clip.webm");
const FPS = 6;
const SECONDS = 170;
const W = 640;
const H = 360;

function findFfmpeg(): string | null {
  const candidates = [process.env.FFMPEG_PATH, "/opt/pw-browsers/ffmpeg-1011/ffmpeg-linux"].filter(Boolean) as string[];
  return candidates.find((c) => existsSync(c)) ?? null;
}

/**
 * Renders a synthetic first-person clip (counter, plates, two hands) in Chromium and encodes it
 * with ffmpeg, so the review player has something to play. Generated on demand, never committed.
 */
export default async function globalSetup(config: FullConfig) {
  if (existsSync(OUT)) return;
  const ffmpeg = findFfmpeg();
  if (!ffmpeg) return console.warn("[e2e] ffmpeg not found: the review player will show the deleted-file state");
  mkdirSync(path.dirname(OUT), { recursive: true });

  const proc = spawn(ffmpeg, ["-y", "-f", "image2pipe", "-c:v", "mjpeg", "-framerate", String(FPS), "-i", "pipe:0", "-c:v", "libvpx", "-b:v", "400k", "-pix_fmt", "yuv420p", OUT], {
    stdio: ["pipe", "ignore", "ignore"],
  });
  const executablePath = config.projects[0]?.use.launchOptions?.executablePath;
  const browser = await chromium.launch({ executablePath });
  const page = await browser.newPage();
  await page.setContent(`<canvas id="c" width="${W}" height="${H}"></canvas>`);
  const total = FPS * SECONDS;
  for (let start = 0; start < total; start += 60) {
    const frames: string[] = await page.evaluate(
      ({ start, count, W, H, FPS }) => {
        const c = document.getElementById("c") as HTMLCanvasElement;
        const g = c.getContext("2d")!;
        const out: string[] = [];
        for (let f = start; f < start + count; f++) {
          const t = f / FPS;
          const sway = Math.sin(t * 0.7) * 10;
          const bg = g.createLinearGradient(0, 0, 0, H);
          bg.addColorStop(0, "#2b2622");
          bg.addColorStop(1, "#14110f");
          g.fillStyle = bg;
          g.fillRect(0, 0, W, H);
          g.fillStyle = "#5a4b3d";
          g.fillRect(-20 + sway, H * 0.55, W + 40, H * 0.45);
          g.fillStyle = "#3a3f46";
          g.fillRect(W * 0.58 + sway, H * 0.18, W * 0.34, H * 0.42);
          g.fillStyle = "#23272c";
          g.fillRect(W * 0.6 + sway, H * 0.22, W * 0.3, H * 0.34);
          for (let i = 0; i < 4; i++) {
            const x = W * (0.12 + i * 0.1) + sway;
            g.fillStyle = "#e9e4dc";
            g.beginPath();
            g.ellipse(x, H * 0.7, 26, 9, 0, 0, Math.PI * 2);
            g.fill();
          }
          const hand = (phase: number, side: number) => {
            const x = W * (0.42 + side * 0.16) + Math.sin(t * 1.1 + phase) * W * 0.12 + sway;
            const y = H * 0.66 + Math.cos(t * 0.9 + phase) * H * 0.12;
            g.fillStyle = "#c99a7a";
            g.beginPath();
            g.ellipse(x, y, 34, 24, side * 0.4, 0, Math.PI * 2);
            g.fill();
            g.fillRect(x - 14 + side * 10, y + 10, 28, H);
          };
          hand(0, -1);
          hand(1.7, 1);
          g.fillStyle = "rgba(0,0,0,0.55)";
          g.fillRect(12, 12, 172, 26);
          g.fillStyle = "#f2f3f5";
          g.font = "500 13px monospace";
          const s = Math.floor(t);
          g.fillText(`DEMO FOOTAGE ${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`, 20, 30);
          out.push(c.toDataURL("image/jpeg", 0.8).split(",")[1]);
        }
        return out;
      },
      { start, count: Math.min(60, total - start), W, H, FPS },
    );
    for (const f of frames) {
      if (proc.exitCode !== null) throw new Error(`[e2e] ffmpeg exited early (${proc.exitCode})`);
      if (!proc.stdin.write(Buffer.from(f, "base64"))) await new Promise((r) => { proc.stdin.once("drain", r); proc.once("exit", r); });
    }
  }
  await browser.close();
  proc.stdin.end();
  await new Promise((resolve) => proc.on("close", resolve));
}
