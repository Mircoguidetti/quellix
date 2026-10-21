import { createReadStream, statSync } from "node:fs";
import { Readable } from "node:stream";
import { connection } from "next/server";
import { isDemoMode } from "@/lib/demo/mode";

/** Demo mode only: serves the local sample video (QUELLIX_DEMO_VIDEO) with range support. */
export async function GET(request: Request) {
  await connection();
  const file = process.env.QUELLIX_DEMO_VIDEO;
  if (!isDemoMode() || !file) return new Response("Not found", { status: 404 });
  let size: number;
  try {
    size = statSync(file).size;
  } catch {
    return new Response("Not found", { status: 404 });
  }
  const type = file.endsWith(".mp4") ? "video/mp4" : "video/webm";
  const range = /bytes=(\d*)-(\d*)/.exec(request.headers.get("range") ?? "");
  if (range) {
    const start = range[1] ? Number(range[1]) : 0;
    const end = range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
    const stream = Readable.toWeb(createReadStream(file, { start, end })) as ReadableStream;
    return new Response(stream, {
      status: 206,
      headers: { "content-type": type, "content-range": `bytes ${start}-${end}/${size}`, "accept-ranges": "bytes", "content-length": String(end - start + 1) },
    });
  }
  const stream = Readable.toWeb(createReadStream(file)) as ReadableStream;
  return new Response(stream, { headers: { "content-type": type, "accept-ranges": "bytes", "content-length": String(size) } });
}
