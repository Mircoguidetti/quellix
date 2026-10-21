import { vi } from "vitest";

export type Call = {
  table: string;
  op: "select" | "insert" | "update" | "upsert" | "delete";
  payload?: unknown;
  filters: [string, unknown][];
  single: boolean;
};
export type Result = { data: unknown; error: { code?: string; message: string } | null };
export type Handler = (call: Call) => Result | undefined;

/**
 * A tiny chainable stand-in for the Supabase client. Each query resolves through `handler`;
 * anything the handler does not answer returns empty data. Every query is recorded in `calls`.
 */
export function createFakeDb(handler: Handler, opts: { exists?: boolean; sendError?: boolean } = {}) {
  const calls: Call[] = [];
  const rpc = vi.fn(async () => ({ data: 1, error: opts.sendError ? { message: "boom" } : null }));
  const signedUpload = vi.fn(async (path: string) => ({
    data: { signedUrl: `https://storage.test/upload/${path}?token=t`, token: "t", path },
    error: null,
  }));

  function from(table: string) {
    const call: Call = { table, op: "select", filters: [], single: false };
    const run = (): Promise<Result> => {
      calls.push(call);
      const res = handler(call) ?? { data: call.single ? null : [], error: null };
      return Promise.resolve(res);
    };
    const builder: Record<string, unknown> = {};
    const chain = (name: string, fn?: (...a: unknown[]) => void) => {
      builder[name] = (...args: unknown[]) => {
        fn?.(...args);
        return builder;
      };
    };
    for (const op of ["insert", "update", "upsert", "delete"] as const) {
      chain(op, (payload) => {
        call.op = op;
        call.payload = payload;
      });
    }
    chain("select");
    for (const f of ["eq", "is", "in", "lt", "gt"]) chain(f, (col, val) => call.filters.push([`${f}:${col}`, val]));
    for (const f of ["or", "order", "limit"]) chain(f);
    builder.single = () => {
      call.single = true;
      return run();
    };
    builder.maybeSingle = builder.single;
    builder.then = (resolve: (v: Result) => unknown, reject: (e: unknown) => unknown) => run().then(resolve, reject);
    return builder;
  }

  const db = {
    from,
    schema: () => ({ rpc }),
    storage: {
      from: () => ({
        createSignedUploadUrl: signedUpload,
        exists: async () => ({ data: opts.exists ?? true, error: null }),
        createSignedUrl: async () => ({ data: { signedUrl: "https://storage.test/dl" }, error: null }),
      }),
    },
  };
  return { db: db as never, calls, rpc, signedUpload };
}

export const KEY = "qx_live_testkey_0123456789abcdef";
export const ORG = "11111111-1111-4111-8111-111111111111";
export const RUBRIC = "22222222-2222-4222-8222-222222222222";
export const VIDEO = "33333333-3333-4333-8333-333333333333";

/** Answers the api_keys lookup for KEY; used by every route test. */
export function keyHandler(call: Call): Result | undefined {
  if (call.table === "api_keys" && call.op === "select") {
    return { data: { id: "key-1", org_id: ORG, revoked_at: null }, error: null };
  }
  return undefined;
}

export const authed = (body?: unknown, method = "POST") =>
  new Request("http://localhost/api/v1/x", {
    method,
    headers: { authorization: `Bearer ${KEY}`, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
