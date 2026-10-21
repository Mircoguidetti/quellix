import { readFileSync } from "node:fs";
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { parse } from "yaml";

/**
 * A mock Quellix API built from packages/contracts/openapi.yaml: routes,
 * success status codes and request-body validation all come from the spec.
 * Only the response bodies are produced by hand-written, stateful handlers.
 */

type Json = Record<string, unknown>;
const spec = parse(readFileSync(new URL("../../contracts/openapi.yaml", import.meta.url), "utf8")) as Json;

interface Operation {
  id: string;
  method: string;
  pattern: RegExp;
  params: string[];
  successStatus: number;
  bodySchema?: Json;
}

function buildOperations(): Operation[] {
  const ops: Operation[] = [];
  for (const [template, item] of Object.entries(spec.paths as Record<string, Json>)) {
    const params: string[] = [];
    const pattern = new RegExp(
      "^" + template.replace(/\{(\w+)\}/g, (_, name: string) => (params.push(name), "([^/]+)")) + "$",
    );
    for (const method of ["get", "post", "put"]) {
      const op = item[method] as Json | undefined;
      if (!op) continue;
      const responses = Object.keys(op.responses as Json);
      const successStatus = Number(responses.find((c) => c.startsWith("2")));
      const content = (op.requestBody as Json | undefined)?.content as Json | undefined;
      ops.push({
        id: op.operationId as string,
        method: method.toUpperCase(),
        pattern,
        params,
        successStatus,
        bodySchema: (content?.["application/json"] as Json | undefined)?.schema as Json | undefined,
      });
    }
  }
  return ops;
}

function resolve(schema: Json): Json {
  const ref = schema.$ref as string | undefined;
  if (!ref) return schema;
  const target = ref.replace("#/", "").split("/").reduce((node, key) => (node as Json)[key], spec as unknown);
  return resolve(target as Json);
}

/** Validates the JSON-Schema subset the contract uses for request bodies. */
export function validate(value: unknown, rawSchema: Json, path = "body"): string[] {
  const schema = resolve(rawSchema);
  const errors: string[] = [];
  if (Array.isArray(schema.enum) && !schema.enum.includes(value)) errors.push(`${path}: must be one of ${schema.enum.join(", ")}`);
  const type = schema.type;
  if (type === "object") {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return [`${path}: must be an object`];
    const obj = value as Json;
    for (const key of (schema.required as string[] | undefined) ?? []) {
      if (!(key in obj)) errors.push(`${path}.${key}: is required`);
    }
    for (const [key, sub] of Object.entries((schema.properties as Record<string, Json> | undefined) ?? {})) {
      if (key in obj) errors.push(...validate(obj[key], sub, `${path}.${key}`));
    }
  } else if (type === "string") {
    if (typeof value !== "string") errors.push(`${path}: must be a string`);
    else if (typeof schema.maxLength === "number" && value.length > schema.maxLength) errors.push(`${path}: too long`);
  } else if (type === "integer") {
    if (!Number.isInteger(value)) errors.push(`${path}: must be an integer`);
    else {
      if (typeof schema.minimum === "number" && (value as number) < schema.minimum) errors.push(`${path}: below minimum`);
      if (typeof schema.maximum === "number" && (value as number) > schema.maximum) errors.push(`${path}: above maximum`);
    }
  }
  return errors;
}

export interface Recorded {
  operationId: string;
  headers: IncomingMessage["headers"];
  body: unknown;
  query: URLSearchParams;
}

export interface MockServer {
  url: string;
  requests: Recorded[];
  uploads: Map<string, Buffer>;
  /** Answer the next `count` API requests with this status instead of handling them. */
  failNext(count: number, status: number, headers?: Record<string, string>): void;
  /** Number of GETs on a video before it becomes `decided`. */
  decideAfterGets: number;
  /** Drop pending injected failures. */
  reset(): void;
  close(): Promise<void>;
}

export async function startMockServer(apiKey = "qx_live_test"): Promise<MockServer> {
  const operations = buildOperations();
  const videos = new Map<string, Json & { gets?: number }>();
  const rubrics = new Map<string, Json[]>();
  const requests: Recorded[] = [];
  const uploads = new Map<string, Buffer>();
  const faults: { status: number; headers: Record<string, string> }[] = [];
  let counter = 0;

  const state = { decideAfterGets: 1 };
  let baseUrl = "";

  const server: Server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://mock");
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const raw = Buffer.concat(chunks);

    const send = (status: number, body?: unknown, headers: Record<string, string> = {}) => {
      res.writeHead(status, { "Content-Type": "application/json", ...headers });
      res.end(body === undefined ? undefined : JSON.stringify(body));
    };
    const error = (status: number, code: string, message: string, extra: Json = {}) =>
      send(status, { error: { code, message, ...extra } });

    // The signed upload target is not part of the API (no bearer token).
    const upload = url.pathname.match(/^\/api\/v1\/__upload\/(.+)$/);
    if (upload && req.method === "PUT") {
      uploads.set(upload[1]!, raw);
      requests.push({ operationId: "__upload", headers: req.headers, body: undefined, query: url.searchParams });
      return send(200);
    }

    const path = url.pathname.replace(/^\/api\/v1/, "");
    const op = operations.find((o) => o.method === req.method && o.pattern.test(path));
    if (!op) return error(404, "not_found", `No route for ${req.method} ${path}`);
    if (req.headers.authorization !== `Bearer ${apiKey}`) return error(401, "unauthorized", "Invalid API key");

    const body = raw.length ? JSON.parse(raw.toString("utf8")) : undefined;
    requests.push({ operationId: op.id, headers: req.headers, body, query: url.searchParams });

    const fault = faults.shift();
    if (fault) return send(fault.status, { error: { code: "injected", message: "Injected failure" } }, fault.headers);

    if (op.bodySchema) {
      const problems = validate(body, op.bodySchema);
      if (problems.length) return error(400, "validation_error", problems[0]!, { fields: problems });
    }

    const args = path.match(op.pattern)!.slice(1);
    const id = args[0] ? decodeURIComponent(args[0]) : "";
    const ok = (payload: unknown) => send(op.successStatus, payload);

    switch (op.id) {
      case "createVideo": {
        const videoId = `vid_${++counter}`;
        const video = {
          id: videoId,
          external_id: (body as Json).external_id ?? null,
          status: "awaiting_upload",
          rubric_id: (body as Json).rubric_id,
          rubric_version: (body as Json).rubric_version ?? 1,
          decision: null,
          review: null,
          lab_outcome: (body as Json).lab_outcome ?? null,
          created_at: new Date().toISOString(),
        };
        videos.set(videoId, { ...video, gets: 0 });
        return ok({ video, upload_url: `${baseUrl}/__upload/${videoId}`, upload_expires_at: new Date(Date.now() + 3600_000).toISOString() });
      }
      case "completeUpload": {
        const v = videos.get(id);
        if (!v) return error(404, "not_found", "Video not found");
        if (v.status !== "awaiting_upload") return error(409, "conflict", "Already completed");
        v.status = "queued";
        return ok(publicVideo(v));
      }
      case "getVideo": {
        const v = videos.get(id);
        if (!v) return error(404, "not_found", "Video not found");
        if (v.status === "queued" || v.status === "processing") {
          v.gets = (v.gets ?? 0) + 1;
          if (v.gets > state.decideAfterGets) {
            v.status = "decided";
            v.decision = { video_id: id, decision: "accept", reasons: [], checks: {}, rubric: { id: v.rubric_id, version: v.rubric_version }, engine_version: "test" };
          } else v.status = "processing";
        }
        return ok(publicVideo(v));
      }
      case "listVideos": {
        const all = [...videos.values()].reverse();
        const limit = Number(url.searchParams.get("limit") ?? 50);
        const start = Number(url.searchParams.get("cursor") ?? 0);
        const slice = all.slice(start, start + limit);
        return ok({ data: slice.map(publicVideo), next_cursor: start + limit < all.length ? String(start + limit) : null });
      }
      case "reviewVideo":
      case "setLabOutcome": {
        const v = videos.get(id);
        if (!v) return error(404, "not_found", "Video not found");
        if (op.id === "reviewVideo") v.review = { ...(body as Json), reviewed_at: new Date().toISOString() };
        else v.lab_outcome = body;
        return ok(publicVideo(v));
      }
      case "createRubric": {
        const rubric = { id: `rub_${++counter}`, version: 1, ...(body as Json) };
        rubrics.set(rubric.id, [rubric]);
        return ok(rubric);
      }
      case "listRubrics":
        return ok({ data: [...rubrics.values()].map((versions) => versions.at(-1)) });
      case "getRubric": {
        const versions = rubrics.get(id);
        const wanted = url.searchParams.get("version");
        const found = versions && (wanted ? versions.find((r) => r.version === Number(wanted)) : versions.at(-1));
        return found ? ok(found) : error(404, "not_found", "Rubric not found");
      }
      case "updateRubric": {
        const versions = rubrics.get(id);
        if (!versions) return error(404, "not_found", "Rubric not found");
        const next = { id, version: versions.length + 1, ...(body as Json) };
        versions.push(next);
        return ok(next);
      }
    }
    return error(500, "unhandled", `No handler for ${op.id}`);

    function publicVideo(v: Json & { gets?: number }): Json {
      const rest = { ...v };
      delete rest.gets;
      return rest;
    }
  });

  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}/api/v1`;

  return {
    url: baseUrl,
    requests,
    uploads,
    failNext(count, status, headers = {}) {
      for (let i = 0; i < count; i++) faults.push({ status, headers });
    },
    get decideAfterGets() {
      return state.decideAfterGets;
    },
    set decideAfterGets(n: number) {
      state.decideAfterGets = n;
    },
    reset() {
      faults.length = 0;
    },
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}
