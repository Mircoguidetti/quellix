import { beforeEach, describe, expect, it, vi } from "vitest";
import { KEY, ORG, RUBRIC, VIDEO, authed, createFakeDb, keyHandler, type Call, type Result } from "@/test/fake-supabase";

let fake: ReturnType<typeof createFakeDb>;
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => fake.db }));

const { POST: createVideo } = await import("../route");
const { POST: review } = await import("../[video_id]/review/route");
const { POST: complete } = await import("../[video_id]/complete/route");

const videoRow = {
  id: VIDEO, org_id: ORG, external_id: "ext-1", contributor_ref: null, rubric_id: RUBRIC, rubric_version: 3,
  status: "awaiting_upload", storage_path: `org/${ORG}/${VIDEO}/clip.mp4`, filename: "clip.mp4", created_at: "2026-10-21T10:00:00Z",
};
const validBody = { rubric_id: RUBRIC, filename: "my clip.mp4", content_type: "video/mp4", size_bytes: 1000, external_id: "ext-1" };
const ctx = (id: string) => ({ params: Promise.resolve({ video_id: id }) }) as never;

function handler(over: (c: Call) => Result | undefined = () => undefined) {
  return (c: Call): Result | undefined => {
    const o = over(c);
    if (o) return o;
    const k = keyHandler(c);
    if (k) return k;
    if (c.table === "rubrics") return { data: { id: RUBRIC, current_version: 3 }, error: null };
    if (c.table === "rubric_versions") return { data: { version: 3 }, error: null };
    if (c.table === "videos" && c.op === "insert") return { data: videoRow, error: null };
    if (c.table === "videos" && c.op === "select") return { data: videoRow, error: null };
    if (c.table === "videos" && c.op === "update") return { data: [{ id: VIDEO }], error: null };
    if (c.table === "jobs") return { data: { id: "job-1" }, error: null };
    return undefined;
  };
}

beforeEach(() => {
  fake = createFakeDb(handler());
});

describe("POST /api/v1/videos", () => {
  it("returns 401 in the error envelope without a key", async () => {
    const res = await createVideo(new Request("http://x/api/v1/videos", { method: "POST", body: "{}" }));
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe("unauthorized");
  });

  it("returns 400 for an invalid body", async () => {
    const res = await createVideo(authed({ ...validBody, content_type: "image/png", size_bytes: 0 }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("invalid_request");
    expect(body.error.message).toContain("content_type");
  });

  it("returns 400 for a body that is not JSON", async () => {
    const res = await createVideo(
      new Request("http://x/api/v1/videos", { method: "POST", headers: { authorization: `Bearer ${KEY}` }, body: "nope" }),
    );
    expect(res.status).toBe(400);
  });

  it("registers the video under the key's org and returns a signed upload URL", async () => {
    const res = await createVideo(authed(validBody));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.video).toMatchObject({ id: VIDEO, status: "awaiting_upload", rubric_id: RUBRIC, decision: null });
    expect(body.upload_url).toContain("https://storage.test/upload/");
    expect(Date.parse(body.upload_expires_at)).toBeGreaterThan(Date.now());

    const insert = fake.calls.find((c) => c.table === "videos" && c.op === "insert")!;
    expect(insert.payload).toMatchObject({ org_id: ORG, rubric_id: RUBRIC, rubric_version: 3, content_type: "video/mp4" });
    const path = (insert.payload as { storage_path: string }).storage_path;
    expect(path).toMatch(new RegExp(`^org/${ORG}/[0-9a-f-]{36}/my_clip\\.mp4$`));
    expect(fake.signedUpload).toHaveBeenCalledWith(path);
  });

  it("returns 404 for a rubric the organization does not have", async () => {
    fake = createFakeDb(handler((c) => (c.table === "rubrics" ? { data: null, error: null } : undefined)));
    const res = await createVideo(authed(validBody));
    expect(res.status).toBe(404);
  });

  it("returns 409 when external_id is already used", async () => {
    fake = createFakeDb(
      handler((c) => (c.table === "videos" && c.op === "insert" ? { data: null, error: { code: "23505", message: "dup" } } : undefined)),
    );
    expect((await createVideo(authed(validBody))).status).toBe(409);
  });
});

describe("POST /api/v1/videos/{id}/review", () => {
  it("rejects a decision other than accept or reject", async () => {
    const res = await review(authed({ decision: "review" }), ctx(VIDEO));
    expect(res.status).toBe(400);
  });

  it("returns 404 for a video id that is not a UUID", async () => {
    expect((await review(authed({ decision: "accept" }), ctx("nope"))).status).toBe(404);
  });

  it("inserts the review for the key's org and returns the video with it embedded", async () => {
    const stored = { video_id: VIDEO, decision: "reject", note: "blurry", created_at: "2026-10-21T11:00:00Z" };
    fake = createFakeDb(handler((c) => (c.table === "reviews" && c.op === "select" ? { data: [stored], error: null } : undefined)));
    const res = await review(authed({ decision: "reject", note: "blurry" }), ctx(VIDEO));
    expect(res.status).toBe(200);
    const insert = fake.calls.find((c) => c.table === "reviews" && c.op === "insert")!;
    expect(insert.payload).toMatchObject({ video_id: VIDEO, org_id: ORG, decision: "reject", note: "blurry", reviewer_id: null });
    expect((await res.json()).review).toMatchObject({ decision: "reject", note: "blurry", reviewed_at: stored.created_at });
  });
});

describe("POST /api/v1/videos/{id}/complete", () => {
  it("queues the analysis: job row, status queued, message on video_jobs", async () => {
    const res = await complete(authed(), ctx(VIDEO));
    expect(res.status).toBe(202);
    expect(fake.calls.some((c) => c.table === "jobs" && c.op === "insert")).toBe(true);
    expect(fake.rpc).toHaveBeenCalledWith("send", { queue_name: "video_jobs", message: { job_id: "job-1", video_id: VIDEO } });
  });

  it("returns 409 when the file is not in Storage and enqueues nothing", async () => {
    fake = createFakeDb(handler(), { exists: false });
    expect((await complete(authed(), ctx(VIDEO))).status).toBe(409);
    expect(fake.rpc).not.toHaveBeenCalled();
  });

  it("returns 409 when the video is not awaiting_upload", async () => {
    fake = createFakeDb(handler((c) => (c.table === "videos" && c.op === "select" ? { data: { ...videoRow, status: "queued" }, error: null } : undefined)));
    expect((await complete(authed(), ctx(VIDEO))).status).toBe(409);
    expect(fake.rpc).not.toHaveBeenCalled();
  });

  it("rolls the status back when enqueueing fails", async () => {
    fake = createFakeDb(handler(), { sendError: true });
    expect((await complete(authed(), ctx(VIDEO))).status).toBe(500);
    const updates = fake.calls.filter((c) => c.table === "videos" && c.op === "update").map((c) => (c.payload as { status: string }).status);
    expect(updates).toEqual(["queued", "awaiting_upload"]);
  });
});
