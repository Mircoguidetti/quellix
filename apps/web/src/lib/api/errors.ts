import { ZodError } from "zod";

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

export const errors = {
  unauthorized: (m = "Missing or invalid API key") => new ApiError(401, "unauthorized", m),
  badRequest: (m: string) => new ApiError(400, "invalid_request", m),
  notFound: (m = "Not found") => new ApiError(404, "not_found", m),
  conflict: (m: string) => new ApiError(409, "conflict", m),
  internal: (m = "Internal error") => new ApiError(500, "internal_error", m),
};

export function errorResponse(err: unknown): Response {
  if (err instanceof ApiError) {
    return Response.json({ error: { code: err.code, message: err.message } }, { status: err.status });
  }
  if (err instanceof ZodError) {
    const message = err.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; ");
    return Response.json({ error: { code: "invalid_request", message } }, { status: 400 });
  }
  console.error(err);
  return Response.json({ error: { code: "internal_error", message: "Internal error" } }, { status: 500 });
}

/** Wrap a handler so thrown ApiError/ZodError become `{error:{code,message}}`. */
export async function handle(fn: () => Promise<Response>): Promise<Response> {
  try {
    return await fn();
  } catch (err) {
    return errorResponse(err);
  }
}

export async function readJson(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    throw errors.badRequest("Body must be valid JSON");
  }
}
