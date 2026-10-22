import {
  ConnectionError,
  OrmesError,
  RateLimitError,
  errorFromResponse,
} from "./errors";

export const DEFAULT_BASE_URL = "https://quellix-orpin.vercel.app/api/v1";

export interface ClientOptions {
  /** API key (`orm_live_...`). Defaults to `ORMES_API_KEY`. */
  apiKey?: string;
  /** Defaults to `ORMES_BASE_URL`, then the public API. */
  baseUrl?: string;
  /** Retries after the first attempt on 429/5xx and network errors. Default 2. */
  maxRetries?: number;
  /** Per-request timeout in milliseconds. Default 30000. */
  timeoutMs?: number;
  /** Custom fetch implementation (tests, proxies). */
  fetch?: typeof fetch;
  /** Sleep function, replaceable in tests. */
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
}

export interface RequestOptions {
  query?: Record<string, string | number | undefined>;
  body?: unknown;
  idempotencyKey?: string;
  signal?: AbortSignal;
}

function env(name: string): string | undefined {
  return (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.[name];
}

/** The new variable name first; the pre-rename `QUELLIX_*` name still works. */
function envWithFallback(name: string, legacy: string): string | undefined {
  return env(name) || env(legacy) || undefined;
}

export function defaultSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal?.reason);
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export class HttpClient {
  readonly baseUrl: string;
  readonly fetchImpl: typeof fetch;
  readonly sleep: (ms: number, signal?: AbortSignal) => Promise<void>;
  private readonly apiKey: string;
  private readonly maxRetries: number;
  private readonly timeoutMs: number;

  constructor(options: ClientOptions = {}) {
    const apiKey = options.apiKey ?? envWithFallback("ORMES_API_KEY", "QUELLIX_API_KEY");
    if (!apiKey) {
      throw new OrmesError("Missing API key: pass `apiKey` or set ORMES_API_KEY.");
    }
    this.apiKey = apiKey;
    this.baseUrl = (options.baseUrl ?? envWithFallback("ORMES_BASE_URL", "QUELLIX_BASE_URL") ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
    this.maxRetries = options.maxRetries ?? 2;
    this.timeoutMs = options.timeoutMs ?? 30_000;
    this.fetchImpl = options.fetch ?? ((input, init) => globalThis.fetch(input, init));
    this.sleep = options.sleep ?? defaultSleep;
  }

  async request<T>(method: string, path: string, options: RequestOptions = {}): Promise<T> {
    const url = new URL(this.baseUrl + path);
    for (const [key, value] of Object.entries(options.query ?? {})) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
      Accept: "application/json",
    };
    if (options.body !== undefined) headers["Content-Type"] = "application/json";
    if (options.idempotencyKey) headers["Idempotency-Key"] = options.idempotencyKey;

    // A POST without an idempotency key may only be retried when the server
    // provably did not process it (429).
    const replaySafe = method !== "POST" || Boolean(options.idempotencyKey);

    for (let attempt = 0; ; attempt++) {
      const last = attempt >= this.maxRetries;
      let response: Response;
      try {
        response = await this.fetchImpl(url, {
          method,
          headers,
          body: options.body === undefined ? undefined : JSON.stringify(options.body),
          signal: this.signalFor(options.signal),
        });
      } catch (cause) {
        if (options.signal?.aborted) throw cause;
        if (last || !replaySafe) {
          throw new ConnectionError(`Request to ${method} ${path} failed: ${String(cause)}`, { cause });
        }
        await this.sleep(backoffMs(attempt), options.signal);
        continue;
      }

      if (response.ok) {
        return (response.status === 204 ? undefined : await response.json()) as T;
      }

      const body = await response.json().catch(() => null);
      const error = errorFromResponse(response.status, body, response.headers);
      const retryable = response.status === 429 || (response.status >= 500 && replaySafe);
      if (!retryable || last) throw error;
      const wait =
        error instanceof RateLimitError && error.retryAfter !== undefined
          ? error.retryAfter * 1000
          : backoffMs(attempt);
      await this.sleep(wait, options.signal);
    }
  }

  private signalFor(user?: AbortSignal): AbortSignal {
    const timeout = AbortSignal.timeout(this.timeoutMs);
    return user ? AbortSignal.any([user, timeout]) : timeout;
  }
}

/** Exponential backoff with full jitter: random in [0, min(8s, 500ms * 2^attempt)]. */
export function backoffMs(attempt: number, random = Math.random): number {
  return random() * Math.min(8000, 500 * 2 ** attempt);
}
