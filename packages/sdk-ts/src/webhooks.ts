import { OrmesError } from "./errors";
import type { VideoDecidedEvent } from "./types";

export const SIGNATURE_HEADER = "Ormes-Signature";
/** Sent before the rename; only read as a fallback. */
export const LEGACY_SIGNATURE_HEADER = "Quellix-Signature";

/**
 * The signature header of a webhook request: `Ormes-Signature`, else the legacy
 * `Quellix-Signature`. Works with any `Headers`-like object (`get`) or a plain record
 * (names matched case-insensitively).
 */
export function signatureFromHeaders(
  headers: { get(name: string): string | null | undefined } | Record<string, string | string[] | undefined>,
): string | undefined {
  const read = (name: string): string | undefined => {
    if (typeof (headers as { get?: unknown }).get === "function") {
      return (headers as { get(name: string): string | null | undefined }).get(name) ?? undefined;
    }
    const entry = Object.entries(headers as Record<string, string | string[] | undefined>).find(
      ([key]) => key.toLowerCase() === name.toLowerCase(),
    );
    const value = entry?.[1];
    return Array.isArray(value) ? value[0] : value;
  };
  return read(SIGNATURE_HEADER) || read(LEGACY_SIGNATURE_HEADER) || undefined;
}

export interface VerifyOptions {
  /** Maximum age of a timestamped signature, in seconds. Default 300. */
  toleranceSeconds?: number;
  /** Current time in milliseconds, replaceable in tests. */
  now?: number;
}

export class WebhookSignatureError extends OrmesError {}

const encoder = new TextEncoder();

/**
 * Verifies the `Ormes-Signature` header against the raw request body.
 *
 * Accepts the timestamped form `t=<unix>,v1=<hex>` (signature over `"<t>.<body>"`,
 * rejected when older than `toleranceSeconds`) and the legacy bare-hex form
 * (signature over the body, no timestamp to check). The comparison is
 * constant-time (`crypto.subtle.verify`). Never re-serialize the body: pass the
 * exact bytes you received.
 */
export async function verifySignature(
  payload: string | Uint8Array,
  header: string | null | undefined,
  secret: string,
  options: VerifyOptions = {},
): Promise<boolean> {
  if (!header) return false;
  const body = typeof payload === "string" ? encoder.encode(payload) : payload;
  const { timestamp, signatures } = parseHeader(header);
  if (signatures.length === 0) return false;

  let signed = body;
  if (timestamp !== undefined) {
    const nowSeconds = (options.now ?? Date.now()) / 1000;
    if (Math.abs(nowSeconds - timestamp) > (options.toleranceSeconds ?? 300)) return false;
    signed = concat(encoder.encode(`${timestamp}.`), body);
  }

  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
  for (const signature of signatures) {
    const bytes = fromHex(signature);
    if (bytes && (await crypto.subtle.verify("HMAC", key, bytes as BufferSource, signed as BufferSource))) return true;
  }
  return false;
}

/** Verifies the signature and returns the parsed event, or throws `WebhookSignatureError`. */
export async function constructEvent(
  payload: string | Uint8Array,
  header: string | null | undefined,
  secret: string,
  options: VerifyOptions = {},
): Promise<VideoDecidedEvent> {
  if (!(await verifySignature(payload, header, secret, options))) {
    throw new WebhookSignatureError("Invalid webhook signature.");
  }
  const text = typeof payload === "string" ? payload : new TextDecoder().decode(payload);
  return JSON.parse(text) as VideoDecidedEvent;
}

function parseHeader(header: string): { timestamp?: number; signatures: string[] } {
  const value = header.trim();
  if (!value.includes("=")) return { signatures: [value] };
  let timestamp: number | undefined;
  const signatures: string[] = [];
  for (const part of value.split(",")) {
    const [k, v] = part.trim().split("=", 2);
    if (k === "t" && v && /^\d+$/.test(v)) timestamp = Number(v);
    else if (k === "v1" && v) signatures.push(v);
  }
  // A malformed timestamp must not downgrade to an unchecked signature.
  if (signatures.length > 0 && timestamp === undefined && value.includes("t=")) return { signatures: [] };
  return { timestamp, signatures };
}

function fromHex(hex: string): Uint8Array | undefined {
  if (hex.length % 2 !== 0 || !/^[0-9a-fA-F]+$/.test(hex)) return undefined;
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  out.set(a);
  out.set(b, a.length);
  return out;
}
