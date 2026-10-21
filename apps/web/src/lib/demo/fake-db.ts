import { randomUUID } from "node:crypto";

/**
 * A tiny in-memory stand-in for the parts of supabase-js the dashboard uses: PostgREST-style
 * table queries, Storage signed URLs, the queue RPC and auth.admin. Used only in demo mode
 * (see ./mode.ts) so the app can be run, screenshotted and tested without a Supabase project.
 */

export type Row = Record<string, unknown>;
type Result = { data: unknown; error: { message: string; code?: string } | null; count?: number | null };
type Filter = (row: Row) => boolean;

export type DemoUser = { id: string; email: string; password: string; name?: string; confirmed: boolean };

export type DemoStore = {
  tables: Record<string, Row[]>;
  users: DemoUser[];
  /** Called when a job is queued; the demo "worker" decides the video a few seconds later. */
  onEnqueue?: (message: { job_id: string; video_id: string }) => void;
};

const UNIQUE: Record<string, string[][]> = {
  videos: [["org_id", "external_id"]],
  rubric_versions: [["rubric_id", "version"]],
  api_keys: [["key_hash"]],
  lab_outcomes: [["video_id"]],
  members: [["org_id", "user_id"]],
};

const DEFAULTS: Record<string, () => Row> = {
  organizations: () => ({ training_opt_in: false, allow_external_models: false }),
  members: () => ({ role: "reviewer" }),
  rubrics: () => ({ current_version: 1 }),
  videos: () => ({ status: "awaiting_upload", external_id: null, contributor_ref: null, duration_s: null, file_deleted_at: null }),
  jobs: () => ({ status: "queued", attempts: 0, error: null }),
  reviews: () => ({ note: null }),
  contests: () => ({ status: "open", resolution_note: null, resolved_by: null, resolved_at: null }),
  api_keys: () => ({ last_used_at: null, revoked_at: null }),
  webhooks: () => ({ active: true }),
};

const NO_ID = new Set(["members", "lab_outcomes", "rubric_versions"]);

function compare(a: unknown, b: unknown): number {
  if (a === b) return 0;
  if (a === null || a === undefined) return 1;
  if (b === null || b === undefined) return -1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a) < String(b) ? -1 : 1;
}

function coerce(raw: string, sample: unknown): unknown {
  if (raw === "null") return null;
  if (typeof sample === "number") return Number(raw);
  if (typeof sample === "boolean") return raw === "true";
  return raw;
}

function likeToRegex(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/%/g, ".*").replace(/_/g, ".");
  return new RegExp(`^${escaped}$`, "i");
}

function opFilter(col: string, op: string, value: string): Filter {
  return (row) => {
    const v = row[col];
    const target = coerce(value, v);
    switch (op) {
      case "eq":
        return v === target;
      case "neq":
        return v !== target;
      case "lt":
        return compare(v, target) < 0;
      case "lte":
        return compare(v, target) <= 0;
      case "gt":
        return compare(v, target) > 0;
      case "gte":
        return compare(v, target) >= 0;
      case "is":
        return value === "null" ? v === null || v === undefined : v === target;
      case "ilike":
        return typeof v === "string" && likeToRegex(value).test(v);
      default:
        throw new Error(`demo db: unsupported operator ${op}`);
    }
  };
}

/** Split on commas that are not inside parentheses. */
function splitTop(expr: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < expr.length; i++) {
    if (expr[i] === "(") depth++;
    else if (expr[i] === ")") depth--;
    else if (expr[i] === "," && depth === 0) {
      parts.push(expr.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(expr.slice(start));
  return parts;
}

/** Parses PostgREST logic trees such as `a.lt.1,and(a.eq.1,id.lt.x)`. */
function parseLogic(expr: string): Filter {
  const terms = splitTop(expr).map(parseLogicTerm);
  return (r) => terms.some((f) => f(r));
}

function parseLogicTerm(term: string): Filter {
  if (/^(and|or)\(/.test(term)) {
    const nested = /^(and|or)\((.*)\)$/.exec(term)!;
    const inner = splitTop(nested[2]).map(parseLogicTerm);
    return nested[1] === "and" ? (r) => inner.every((f) => f(r)) : (r) => inner.some((f) => f(r));
  }
  const first = term.indexOf(".");
  const second = term.indexOf(".", first + 1);
  return opFilter(term.slice(0, first), term.slice(first + 1, second), term.slice(second + 1));
}

function project(row: Row, columns: string): Row {
  const cols = columns.split(",").map((c) => c.trim()).filter(Boolean);
  if (!cols.length || cols.includes("*")) return { ...row };
  const out: Row = {};
  for (const c of cols) out[c] = row[c];
  return out;
}

class Query implements PromiseLike<Result> {
  private op: "select" | "insert" | "update" | "upsert" | "delete" = "select";
  private filters: Filter[] = [];
  private orders: [string, boolean][] = [];
  private max: number | null = null;
  private offset = 0;
  private mode: "many" | "single" | "maybe" = "many";
  private columns: string | null = "*";
  private returning = false;
  private payload: Row | Row[] | null = null;
  private conflict: string[] | null = null;
  private countMode = false;
  private headOnly = false;

  constructor(
    private store: DemoStore,
    private table: string,
  ) {}

  select(columns = "*", opts?: { count?: string; head?: boolean }) {
    if (this.op === "select") {
      this.columns = columns;
      this.countMode = !!opts?.count;
      this.headOnly = !!opts?.head;
    } else {
      this.returning = true;
      this.columns = columns;
    }
    return this;
  }
  insert(payload: Row | Row[]) {
    this.op = "insert";
    this.payload = payload;
    return this;
  }
  upsert(payload: Row | Row[], opts?: { onConflict?: string }) {
    this.op = "upsert";
    this.payload = payload;
    this.conflict = opts?.onConflict?.split(",").map((s) => s.trim()) ?? ["id"];
    return this;
  }
  update(payload: Row) {
    this.op = "update";
    this.payload = payload;
    return this;
  }
  delete() {
    this.op = "delete";
    return this;
  }
  eq(col: string, v: unknown) {
    this.filters.push((r) => r[col] === v);
    return this;
  }
  neq(col: string, v: unknown) {
    this.filters.push((r) => r[col] !== v);
    return this;
  }
  gt(col: string, v: unknown) {
    this.filters.push((r) => compare(r[col], v) > 0);
    return this;
  }
  gte(col: string, v: unknown) {
    this.filters.push((r) => compare(r[col], v) >= 0);
    return this;
  }
  lt(col: string, v: unknown) {
    this.filters.push((r) => compare(r[col], v) < 0);
    return this;
  }
  lte(col: string, v: unknown) {
    this.filters.push((r) => compare(r[col], v) <= 0);
    return this;
  }
  in(col: string, values: unknown[]) {
    const set = new Set(values);
    this.filters.push((r) => set.has(r[col]));
    return this;
  }
  is(col: string, v: unknown) {
    this.filters.push((r) => (v === null ? r[col] === null || r[col] === undefined : r[col] === v));
    return this;
  }
  ilike(col: string, pattern: string) {
    const re = likeToRegex(pattern);
    this.filters.push((r) => typeof r[col] === "string" && re.test(r[col] as string));
    return this;
  }
  or(expr: string) {
    this.filters.push(parseLogic(expr));
    return this;
  }
  order(col: string, opts?: { ascending?: boolean }) {
    this.orders.push([col, opts?.ascending ?? true]);
    return this;
  }
  limit(n: number) {
    this.max = n;
    return this;
  }
  range(from: number, to: number) {
    this.offset = from;
    this.max = to - from + 1;
    return this;
  }
  single() {
    this.mode = "single";
    return this;
  }
  maybeSingle() {
    this.mode = "maybe";
    return this;
  }

  then<A = Result, B = never>(ok?: ((v: Result) => A | PromiseLike<A>) | null, fail?: ((e: unknown) => B | PromiseLike<B>) | null) {
    return Promise.resolve()
      .then(() => this.run())
      .then(ok, fail);
  }

  private rows(): Row[] {
    return (this.store.tables[this.table] ??= []);
  }

  private matches(): Row[] {
    return this.rows().filter((r) => this.filters.every((f) => f(r)));
  }

  private violates(candidate: Row, ignore?: Row): boolean {
    return (UNIQUE[this.table] ?? []).some((cols) =>
      cols.every((c) => candidate[c] !== null && candidate[c] !== undefined) &&
      this.rows().some((r) => r !== ignore && cols.every((c) => r[c] === candidate[c])),
    );
  }

  private finish(rows: Row[]): Result {
    let out = rows;
    for (const [col, asc] of [...this.orders].reverse()) {
      out = [...out].sort((a, b) => (asc ? compare(a[col], b[col]) : -compare(a[col], b[col])));
    }
    const total = out.length;
    if (this.offset) out = out.slice(this.offset);
    if (this.max !== null) out = out.slice(0, this.max);
    const projected = out.map((r) => project(r, this.columns ?? "*"));
    if (this.headOnly) return { data: null, error: null, count: total };
    if (this.mode === "single") {
      if (projected.length !== 1) return { data: null, error: { message: "JSON object requested, multiple (or no) rows returned", code: "PGRST116" } };
      return { data: projected[0], error: null };
    }
    if (this.mode === "maybe") {
      if (projected.length > 1) return { data: null, error: { message: "multiple rows", code: "PGRST116" } };
      return { data: projected[0] ?? null, error: null };
    }
    return { data: projected, error: null, count: this.countMode ? total : null };
  }

  private run(): Result {
    const now = new Date().toISOString();
    switch (this.op) {
      case "select":
        return this.finish(this.matches());
      case "insert": {
        const list = Array.isArray(this.payload) ? this.payload : [this.payload!];
        const created: Row[] = [];
        for (const p of list) {
          const row: Row = {
            ...(NO_ID.has(this.table) ? {} : { id: randomUUID() }),
            created_at: now,
            ...(DEFAULTS[this.table]?.() ?? {}),
            ...p,
          };
          if (this.violates(row)) return { data: null, error: { message: "duplicate key value", code: "23505" } };
          created.push(row);
        }
        this.rows().push(...created);
        return this.returning ? this.finish(created) : { data: null, error: null };
      }
      case "upsert": {
        const list = Array.isArray(this.payload) ? this.payload : [this.payload!];
        const touched: Row[] = [];
        for (const p of list) {
          const existing = this.rows().find((r) => this.conflict!.every((c) => r[c] === p[c]));
          if (existing) {
            Object.assign(existing, p);
            touched.push(existing);
          } else {
            const row: Row = { created_at: now, ...(DEFAULTS[this.table]?.() ?? {}), ...p };
            this.rows().push(row);
            touched.push(row);
          }
        }
        return this.returning ? this.finish(touched) : { data: null, error: null };
      }
      case "update": {
        const hits = this.matches();
        for (const r of hits) {
          const next = { ...r, ...(this.payload as Row) };
          if (this.violates(next, r)) return { data: null, error: { message: "duplicate key value", code: "23505" } };
          Object.assign(r, this.payload);
        }
        return this.returning ? this.finish(hits) : { data: null, error: null };
      }
      case "delete": {
        const hits = new Set(this.matches());
        this.store.tables[this.table] = this.rows().filter((r) => !hits.has(r));
        cascadeDelete(this.store, this.table, [...hits]);
        return this.returning ? this.finish([...hits]) : { data: null, error: null };
      }
    }
  }
}

/** Enough cascading for what the dashboard deletes (rubrics and videos roll back on failure). */
function cascadeDelete(store: DemoStore, table: string, rows: Row[]) {
  const ids = new Set(rows.map((r) => r.id));
  const children: Record<string, [string, string][]> = {
    rubrics: [["rubric_versions", "rubric_id"]],
    videos: [["decisions", "video_id"], ["reviews", "video_id"], ["jobs", "video_id"], ["lab_outcomes", "video_id"], ["contests", "video_id"]],
    organizations: [["members", "org_id"]],
  };
  for (const [child, col] of children[table] ?? []) {
    store.tables[child] = (store.tables[child] ?? []).filter((r) => !ids.has(r[col]));
  }
}

export function createFakeClient(store: DemoStore) {
  const storage = {
    from: () => ({
      createSignedUrl: async (path: string) => {
        const file = process.env.QUELLIX_DEMO_VIDEO;
        return file ? { data: { signedUrl: `/api/demo/video?p=${encodeURIComponent(path)}` }, error: null } : { data: null, error: null };
      },
      createSignedUploadUrl: async (path: string) => ({ data: { signedUrl: `/api/demo/upload?p=${encodeURIComponent(path)}`, path, token: "demo" }, error: null }),
      exists: async () => ({ data: true, error: null }),
    }),
  };

  const auth = {
    admin: {
      getUserById: async (id: string) => {
        const user = store.users.find((u) => u.id === id);
        return { data: { user: user ? { id: user.id, email: user.email, user_metadata: { full_name: user.name } } : null }, error: user ? null : { message: "User not found" } };
      },
      listUsers: async () => ({ data: { users: store.users.map((u) => ({ id: u.id, email: u.email, user_metadata: { full_name: u.name } })) }, error: null }),
      inviteUserByEmail: async (email: string) => {
        if (store.users.some((u) => u.email === email)) return { data: { user: null }, error: { message: "A user with this email address has already been registered", code: "email_exists" } };
        const user: DemoUser = { id: randomUUID(), email, password: randomUUID(), confirmed: false };
        store.users.push(user);
        return { data: { user: { id: user.id, email } }, error: null };
      },
    },
  };

  return {
    from: (table: string) => new Query(store, table),
    storage,
    auth,
    schema: () => ({
      rpc: async (_fn: string, args: { message: { job_id: string; video_id: string } }) => {
        store.onEnqueue?.(args.message);
        return { data: [1], error: null };
      },
    }),
  };
}
