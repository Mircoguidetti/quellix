export interface ErrorBody {
  code?: string;
  message?: string;
  details?: unknown;
  fields?: unknown;
}

export class OrmesError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = new.target.name;
  }
}

export class APIError extends OrmesError {
  readonly status: number;
  readonly code: string;
  readonly requestId: string | undefined;
  readonly body: unknown;

  constructor(
    status: number,
    code: string,
    message: string,
    options: { requestId?: string; body?: unknown } = {},
  ) {
    super(message);
    this.status = status;
    this.code = code;
    this.requestId = options.requestId;
    this.body = options.body;
  }
}

export class AuthenticationError extends APIError {}
export class NotFoundError extends APIError {}

export class ValidationError extends APIError {
  /** Field-level details when the API provides them (`error.fields` or `error.details`). */
  readonly fields: unknown;

  constructor(
    status: number,
    code: string,
    message: string,
    options: { requestId?: string; body?: unknown; fields?: unknown } = {},
  ) {
    super(status, code, message, options);
    this.fields = options.fields;
  }
}

export class RateLimitError extends APIError {
  /** Seconds to wait before retrying, from the `Retry-After` header. */
  readonly retryAfter: number | undefined;

  constructor(
    code: string,
    message: string,
    options: { requestId?: string; body?: unknown; retryAfter?: number } = {},
  ) {
    super(429, code, message, options);
    this.retryAfter = options.retryAfter;
  }
}

/** Network failure, timeout or abort; no HTTP response was received. */
export class ConnectionError extends OrmesError {}

/** `waitForDecision` ran out of time. */
export class TimeoutError extends OrmesError {}

export function errorFromResponse(
  status: number,
  body: unknown,
  headers: Headers,
): APIError {
  const err = (body as { error?: ErrorBody } | null)?.error;
  const code = err?.code ?? `http_${status}`;
  const message = err?.message ?? `Request failed with status ${status}`;
  const requestId = headers.get("x-request-id") ?? undefined;
  const base = { requestId, body };
  if (status === 401 || status === 403) return new AuthenticationError(status, code, message, base);
  if (status === 404) return new NotFoundError(status, code, message, base);
  if (status === 429) {
    return new RateLimitError(code, message, { ...base, retryAfter: parseRetryAfter(headers.get("retry-after")) });
  }
  if (status === 400 || status === 422) {
    return new ValidationError(status, code, message, { ...base, fields: err?.fields ?? err?.details });
  }
  return new APIError(status, code, message, base);
}

export function parseRetryAfter(value: string | null, now = Date.now()): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds);
  const date = Date.parse(value);
  return Number.isNaN(date) ? undefined : Math.max(0, (date - now) / 1000);
}
