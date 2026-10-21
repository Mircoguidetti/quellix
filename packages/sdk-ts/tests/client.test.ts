import { createHmac } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  APIError,
  AuthenticationError,
  NotFoundError,
  Quellix,
  RateLimitError,
  TimeoutError,
  ValidationError,
  constructEvent,
  verifySignature,
} from "../src/index";
import { startMockServer, type MockServer } from "./mock-server";

let mock: MockServer;
const noSleep = async () => {};
const client = (extra = {}) => new Quellix({ apiKey: "qx_live_test", baseUrl: mock.url, sleep: noSleep, ...extra });
const videoParams = { rubric_id: "rub_x", filename: "clip.mp4", content_type: "video/mp4" as const };

beforeAll(async () => {
  mock = await startMockServer();
});
afterAll(() => mock.close());
beforeEach(() => {
  mock.requests.length = 0;
  mock.reset();
  mock.decideAfterGets = 1;
});

describe("videos", () => {
  it("creates a video with an idempotency key", async () => {
    const res = await client().videos.create({ ...videoParams, size_bytes: 10 });
    expect(res.video.status).toBe("awaiting_upload");
    expect(res.upload_url).toContain("/__upload/");
    expect(mock.requests[0]!.headers["idempotency-key"]).toMatch(/^[0-9a-f-]{36}$/);
    expect(mock.requests[0]!.headers.authorization).toBe("Bearer qx_live_test");
  });

  it("uploads bytes with progress and completes", async () => {
    const bytes = new Uint8Array(3 * 1024 * 1024 + 5).fill(7);
    const progress: number[] = [];
    const video = await client().videos.upload(bytes, videoParams, {
      onProgress: (p) => progress.push(p.bytesUploaded),
    });
    expect(video.status).toBe("queued");
    expect(mock.uploads.get(video.id)?.byteLength).toBe(bytes.byteLength);
    expect(progress.at(-1)).toBe(bytes.byteLength);
    expect(progress.length).toBeGreaterThan(1);
    const put = mock.requests.find((r) => r.operationId === "__upload")!;
    expect(put.headers.authorization).toBeUndefined();
    expect(put.headers["content-type"]).toBe("video/mp4");
  });

  it("uploads a file path and infers name, size and type", async () => {
    const dir = mkdtempSync(join(tmpdir(), "qx-"));
    const file = join(dir, "kitchen.mov");
    writeFileSync(file, Buffer.alloc(2048, 1));
    const video = await client().videos.upload(file, { rubric_id: "rub_x" });
    expect(mock.uploads.get(video.id)?.byteLength).toBe(2048);
    const create = mock.requests.find((r) => r.operationId === "createVideo")!;
    expect(create.body).toMatchObject({ filename: "kitchen.mov", content_type: "video/quicktime", size_bytes: 2048 });
  });

  it("uploads a Blob and a stream", async () => {
    const blob = new File([new Uint8Array(100)], "a.webm", { type: "video/webm" });
    const v1 = await client().videos.upload(blob, { rubric_id: "rub_x" });
    expect(mock.uploads.get(v1.id)?.byteLength).toBe(100);
    const stream = new Blob([new Uint8Array(50)]).stream() as ReadableStream<Uint8Array>;
    const v2 = await client().videos.upload(stream, { ...videoParams, size_bytes: 50 });
    expect(mock.uploads.get(v2.id)?.byteLength).toBe(50);
    await expect(client().videos.upload(new Blob([new Uint8Array(1)]).stream() as ReadableStream<Uint8Array>, videoParams)).rejects.toThrow(/size_bytes/);
  });

  it("auto-paginates list", async () => {
    const c = client();
    for (let i = 0; i < 5; i++) await c.videos.create({ ...videoParams, size_bytes: 1 });
    mock.requests.length = 0;
    const ids: string[] = [];
    for await (const v of c.videos.list({ limit: 2 })) ids.push(v.id);
    expect(ids.length).toBeGreaterThanOrEqual(5);
    expect(new Set(ids).size).toBe(ids.length);
    expect(mock.requests.filter((r) => r.operationId === "listVideos").length).toBeGreaterThanOrEqual(3);
  });

  it("waits for a decision with backoff", async () => {
    const c = client();
    const { video } = await c.videos.upload(new Uint8Array(4), videoParams).then((v) => ({ video: v }));
    mock.decideAfterGets = 2;
    const decided = await c.videos.waitForDecision(video.id);
    expect(decided.status).toBe("decided");
    expect(decided.decision?.decision).toBe("accept");
  });

  it("times out waiting", async () => {
    const c = client();
    const video = await c.videos.upload(new Uint8Array(4), videoParams);
    mock.decideAfterGets = 1_000_000;
    await expect(c.videos.waitForDecision(video.id, { timeoutMs: 0 })).rejects.toBeInstanceOf(TimeoutError);
  });
});

describe("review, lab outcome and rubrics", () => {
  it("submits review and lab outcome", async () => {
    const c = client();
    const video = await c.videos.upload(new Uint8Array(4), videoParams);
    const reviewed = await c.review.submit(video.id, { decision: "reject", note: "blurry" });
    expect(reviewed.review).toMatchObject({ decision: "reject", note: "blurry" });
    const labbed = await c.labOutcome.submit(video.id, { outcome: "accept" });
    expect(labbed.lab_outcome).toEqual({ outcome: "accept" });
  });

  it("creates, reads, lists and versions rubrics", async () => {
    const c = client();
    const input = { name: "Dishes", task: { description: "Load dishwasher" }, checks: {} };
    const created = await c.rubrics.create(input);
    expect(created.version).toBe(1);
    const next = await c.rubrics.newVersion(created.id, { ...input, name: "Dishes v2" });
    expect(next.version).toBe(2);
    expect((await c.rubrics.get(created.id)).version).toBe(2);
    expect((await c.rubrics.get(created.id, { version: 1 })).name).toBe("Dishes");
    expect((await c.rubrics.list()).some((r) => r.id === created.id)).toBe(true);
  });
});

describe("errors and retries", () => {
  it("maps statuses to typed errors", async () => {
    await expect(new Quellix({ apiKey: "wrong", baseUrl: mock.url }).videos.get("x")).rejects.toBeInstanceOf(AuthenticationError);
    await expect(client().videos.get("missing")).rejects.toBeInstanceOf(NotFoundError);
    const err = await client().videos.create({ ...videoParams, size_bytes: 0 }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ValidationError);
    expect((err as ValidationError).fields).toBeTruthy();
  });

  it("retries 5xx and honors Retry-After on 429", async () => {
    const sleeps: number[] = [];
    const c = client({ sleep: async (ms: number) => void sleeps.push(ms) });
    mock.failNext(1, 503);
    await c.videos.get("missing").catch(() => {});
    expect(mock.requests.filter((r) => r.operationId === "getVideo")).toHaveLength(2);

    mock.requests.length = 0;
    sleeps.length = 0;
    mock.failNext(1, 429, { "Retry-After": "3" });
    await c.videos.get("missing").catch(() => {});
    expect(sleeps).toEqual([3000]);
  });

  it("gives up with RateLimitError carrying retryAfter", async () => {
    mock.failNext(5, 429, { "Retry-After": "7" });
    const err = await client({ maxRetries: 1 }).videos.get("x").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RateLimitError);
    expect((err as RateLimitError).retryAfter).toBe(7);
  });

  it("retries create (idempotency key) on 500 but not complete", async () => {
    const c = client();
    mock.failNext(1, 500);
    await c.videos.create({ ...videoParams, size_bytes: 1 });
    const keys = mock.requests.map((r) => r.headers["idempotency-key"]);
    expect(keys).toHaveLength(2);
    expect(keys[0]).toBe(keys[1]);

    mock.requests.length = 0;
    mock.failNext(1, 500);
    await expect(c.videos.complete("vid_1")).rejects.toBeInstanceOf(APIError);
    expect(mock.requests).toHaveLength(1);
  });

  it("requires an API key", () => {
    const saved = process.env.QUELLIX_API_KEY;
    delete process.env.QUELLIX_API_KEY;
    expect(() => new Quellix()).toThrow(/API key/);
    if (saved) process.env.QUELLIX_API_KEY = saved;
  });

  it("reads QUELLIX_BASE_URL and QUELLIX_API_KEY from the environment", async () => {
    process.env.QUELLIX_API_KEY = "qx_live_test";
    process.env.QUELLIX_BASE_URL = mock.url;
    try {
      await expect(new Quellix().videos.get("missing")).rejects.toBeInstanceOf(NotFoundError);
    } finally {
      delete process.env.QUELLIX_API_KEY;
      delete process.env.QUELLIX_BASE_URL;
    }
  });
});

describe("webhooks", () => {
  const secret = "whsec_test";
  const body = JSON.stringify({ type: "video.decided", created_at: "2026-01-01T00:00:00Z", data: { id: "vid_1" } });
  const hmac = (data: string) => createHmac("sha256", secret).update(data).digest("hex");
  const now = 1_800_000_000_000;

  it("accepts the bare hex signature over the body", async () => {
    expect(await verifySignature(body, hmac(body), secret)).toBe(true);
    expect(await verifySignature(new TextEncoder().encode(body), hmac(body), secret)).toBe(true);
  });

  it("accepts a timestamped signature within tolerance", async () => {
    const t = now / 1000;
    const header = `t=${t},v1=${hmac(`${t}.${body}`)}`;
    expect(await verifySignature(body, header, secret, { now })).toBe(true);
    expect(await verifySignature(body, header, secret, { now: now + 299_000 })).toBe(true);
  });

  it("rejects stale, tampered, malformed and missing signatures", async () => {
    const t = now / 1000;
    const header = `t=${t},v1=${hmac(`${t}.${body}`)}`;
    expect(await verifySignature(body, header, secret, { now: now + 301_000 })).toBe(false);
    expect(await verifySignature(body + " ", header, secret, { now })).toBe(false);
    expect(await verifySignature(body, header, "other", { now })).toBe(false);
    expect(await verifySignature(body, "zz", secret)).toBe(false);
    expect(await verifySignature(body, hmac(body).slice(2), secret)).toBe(false);
    expect(await verifySignature(body, undefined, secret)).toBe(false);
    // A bad timestamp must not fall back to an unchecked signature.
    expect(await verifySignature(body, `t=abc,v1=${hmac(body)}`, secret)).toBe(false);
  });

  it("constructs a typed event or throws", async () => {
    const event = await constructEvent(body, hmac(body), secret);
    expect(event.data.id).toBe("vid_1");
    await expect(constructEvent(body, "00", secret)).rejects.toThrow(/signature/i);
  });
});
