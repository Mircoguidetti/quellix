import { beforeEach, describe, expect, it, vi } from "vitest";
import { KEY, ORG, RUBRIC, createFakeDb, keyHandler, type Call, type Result } from "@/test/fake-supabase";

let fake: ReturnType<typeof createFakeDb>;
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => fake.db }));
// connection() needs a Next request scope; in a unit test every call is a request.
vi.mock("next/server", async (original) => ({ ...(await original<typeof import("next/server")>()), connection: async () => {} }));

const { GET } = await import("./route");

const get = (qs = "", key: string | null = KEY) =>
  GET(new Request(`http://localhost/api/v1/audit${qs}`, { headers: key ? { authorization: `Bearer ${key}` } : {} }));

const V1 = "55555555-5555-4555-8555-555555555555";
const videoRow = { id: V1, external_id: "ext-1", rubric_id: RUBRIC, rubric_version: 3, created_at: "2026-10-10T10:00:00Z" };
const decisionRow = {
  video_id: V1,
  decision: "reject",
  reasons: [{ check: "technical", code: "technical.too_short", effect: "reject" }],
  checks: { technical: { status: "fail" } },
  created_at: "2026-10-10T10:01:00Z",
};

const range = (c: Call) => (c.filters.find(([k]) => k === "range")?.[1] as [number, number] | undefined) ?? [0, 999];

function handler(over: (c: Call) => Result | undefined = () => undefined) {
  return (c: Call): Result | undefined => {
    const o = over(c);
    if (o) return o;
    const k = keyHandler(c);
    if (k) return k;
    if (c.table === "rubrics" && c.single) return { data: { id: RUBRIC }, error: null };
    if (c.table === "rubrics") return { data: [{ id: RUBRIC, name: "Load the dishwasher" }], error: null };
    if (c.table === "videos") return { data: range(c)[0] === 0 ? [videoRow] : [], error: null };
    if (c.table === "decisions") return { data: [decisionRow], error: null };
    if (c.table === "reviews") return { data: [], error: null };
    return undefined;
  };
}

beforeEach(() => {
  fake = createFakeDb(handler());
});

describe("GET /api/v1/audit", () => {
  it("requires an API key", async () => {
    const res = await get("", null);
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe("unauthorized");
  });

  it("returns the JSON report, scoped to the key's organization", async () => {
    const res = await get("?from=2026-10-01&to=2026-10-31");
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = await res.json();
    expect(body.object).toBe("audit_report");
    expect(body.window).toEqual({ from: "2026-10-01", to: "2026-10-31" });
    expect(body.groups).toHaveLength(1);
    expect(body.groups[0]).toMatchObject({
      rubric: { id: RUBRIC, name: "Load the dishwasher", version: 3 },
      videos: { received: 1, decided: 1, reject: 1 },
      rejection_codes: [{ code: "technical.too_short", count: 1 }],
    });

    for (const c of fake.calls.filter((c) => c.table !== "api_keys")) {
      expect(c.filters, c.table).toContainEqual(["eq:org_id", ORG]);
    }
    const videos = fake.calls.find((c) => c.table === "videos")!;
    expect(videos.filters).toContainEqual(["gte:created_at", "2026-10-01T00:00:00.000Z"]);
    expect(videos.filters).toContainEqual(["lt:created_at", "2026-11-01T00:00:00.000Z"]);
    const decisions = fake.calls.find((c) => c.table === "decisions")!;
    expect(decisions.filters).toContainEqual(["in:video_id", [V1]]);
  });

  it("returns CSV as a download", async () => {
    const res = await get("?from=2026-10-01&to=2026-10-31&format=csv");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/csv; charset=utf-8");
    expect(res.headers.get("content-disposition")).toBe('attachment; filename="audit_2026-10-01_2026-10-31.csv"');
    const text = await res.text();
    expect(text.split("\r\n")[0]).toBe("rubric_id,rubric_name,rubric_version,section,key,metric,value");
    expect(text).toContain(`${RUBRIC},Load the dishwasher,3,rejection_code,technical.too_short,count,1`);
  });

  it("filters by rubric and version", async () => {
    const res = await get(`?rubric_id=${RUBRIC}&version=3`);
    expect(res.status).toBe(200);
    const videos = fake.calls.find((c) => c.table === "videos")!;
    expect(videos.filters).toContainEqual(["eq:rubric_id", RUBRIC]);
    expect(videos.filters).toContainEqual(["eq:rubric_version", 3]);
  });

  it("returns 404 for a rubric of another organization", async () => {
    fake = createFakeDb(handler((c) => (c.table === "rubrics" && c.single ? { data: null, error: null } : undefined)));
    const res = await get(`?rubric_id=${RUBRIC}`);
    expect(res.status).toBe(404);
  });

  it("returns 400 for an invalid query", async () => {
    for (const qs of ["?from=2026-13-01", "?version=2", "?format=xml", "?from=2026-10-05&to=2026-10-01", "?from=2024-01-01&to=2026-10-01"]) {
      const res = await get(qs);
      expect(res.status, qs).toBe(400);
      expect((await res.json()).error.code).toBe("invalid_request");
    }
  });

  it("pages past the 1000-row API limit", async () => {
    const page = Array.from({ length: 1000 }, (_, i) => ({ ...videoRow, id: `v-${i}` }));
    fake = createFakeDb(
      handler((c) => {
        if (c.table !== "videos") return undefined;
        const [from] = range(c);
        return { data: from === 0 ? page : from === 1000 ? [videoRow] : [], error: null };
      }),
    );
    const res = await get("?from=2026-10-01&to=2026-10-31");
    const body = await res.json();
    expect(body.groups[0].videos.received).toBe(1001);
    expect(fake.calls.filter((c) => c.table === "videos")).toHaveLength(2);
    // 1001 ids in chunks of 150 → 7 decision queries.
    expect(fake.calls.filter((c) => c.table === "decisions")).toHaveLength(7);
  });

  it("asks for a narrower window instead of loading too many videos", async () => {
    const page = Array.from({ length: 1000 }, (_, i) => ({ ...videoRow, id: `v-${i}` }));
    fake = createFakeDb(handler((c) => (c.table === "videos" ? { data: page, error: null } : undefined)));
    const res = await get("?from=2026-01-01&to=2026-10-31");
    expect(res.status).toBe(400);
    expect((await res.json()).error.message).toContain("shorter window");
  });

  it("returns 500 in the error envelope when the database fails", async () => {
    fake = createFakeDb(handler((c) => (c.table === "videos" ? { data: null, error: { message: "boom" } } : undefined)));
    const res = await get();
    expect(res.status).toBe(500);
    expect((await res.json()).error.code).toBe("internal_error");
  });
});
