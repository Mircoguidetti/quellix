import { APIError, OrmesError, TimeoutError } from "../errors";
import type { HttpClient } from "../http";
import type {
  CreateVideoRequest,
  CreateVideoResponse,
  ListVideosParams,
  Video,
} from "../types";

export type UploadSource = Blob | Uint8Array | ArrayBuffer | ReadableStream<Uint8Array> | string;

export interface UploadProgress {
  bytesUploaded: number;
  totalBytes: number;
}

export interface UploadParams extends Omit<CreateVideoRequest, "filename" | "content_type" | "size_bytes"> {
  /** Inferred from the file path or `File` name when omitted. */
  filename?: string;
  /** Inferred from the file extension or `Blob` type when omitted. */
  content_type?: CreateVideoRequest["content_type"];
  /** Required only for streams; inferred otherwise. */
  size_bytes?: number;
}

export interface UploadOptions {
  onProgress?: (progress: UploadProgress) => void;
  idempotencyKey?: string;
  signal?: AbortSignal;
}

export interface WaitOptions {
  /** Give up after this many milliseconds. Default 600000 (10 minutes). */
  timeoutMs?: number;
  /** First polling interval. Default 1000. */
  initialIntervalMs?: number;
  /** Intervals grow by 1.5x up to this cap. Default 15000. */
  maxIntervalMs?: number;
  signal?: AbortSignal;
}

const TERMINAL_STATUSES: ReadonlySet<Video["status"]> = new Set(["decided", "failed", "deleted"]);

const CONTENT_TYPES: Record<string, CreateVideoRequest["content_type"]> = {
  mp4: "video/mp4",
  mov: "video/quicktime",
  webm: "video/webm",
};

interface ResolvedSource {
  stream: ReadableStream<Uint8Array>;
  size?: number;
  filename?: string;
  contentType?: string;
}

export class Videos {
  constructor(private readonly http: HttpClient) {}

  /** Registers a video and returns a signed upload target. The key is generated when omitted. */
  create(params: CreateVideoRequest, options: { idempotencyKey?: string; signal?: AbortSignal } = {}): Promise<CreateVideoResponse> {
    return this.http.request("POST", "/videos", {
      body: params,
      idempotencyKey: options.idempotencyKey ?? crypto.randomUUID(),
      signal: options.signal,
    });
  }

  /** Marks the upload as finished and queues the analysis. */
  complete(videoId: string, options: { signal?: AbortSignal } = {}): Promise<Video> {
    return this.http.request("POST", `/videos/${encodeURIComponent(videoId)}/complete`, options);
  }

  get(videoId: string, options: { signal?: AbortSignal } = {}): Promise<Video> {
    return this.http.request("GET", `/videos/${encodeURIComponent(videoId)}`, options);
  }

  /** One page of videos, newest first. */
  listPage(params: ListVideosParams = {}, options: { signal?: AbortSignal } = {}): Promise<{ data: Video[]; next_cursor?: string | null }> {
    return this.http.request("GET", "/videos", { query: params, signal: options.signal });
  }

  /** Iterates over every matching video, fetching pages as needed. */
  async *list(params: ListVideosParams = {}, options: { signal?: AbortSignal } = {}): AsyncGenerator<Video, void, undefined> {
    let cursor = params.cursor;
    do {
      const page = await this.listPage({ ...params, cursor }, options);
      yield* page.data;
      cursor = page.next_cursor ?? undefined;
    } while (cursor);
  }

  /**
   * Creates the video, uploads the bytes to the signed URL and calls `complete`.
   * Uploads are not retried: a failed upload throws and the caller can retry
   * with the same `idempotencyKey`.
   */
  async upload(source: UploadSource, params: UploadParams, options: UploadOptions = {}): Promise<Video> {
    const resolved = await resolveSource(source);
    const size = params.size_bytes ?? resolved.size;
    const filename = params.filename ?? resolved.filename;
    const contentType = params.content_type ?? contentTypeOf(resolved.contentType, filename);
    if (size === undefined) throw new OrmesError("`size_bytes` is required when uploading a stream.");
    if (!filename) throw new OrmesError("`filename` is required when it cannot be inferred from the source.");
    if (!contentType) throw new OrmesError("`content_type` is required: use video/mp4, video/quicktime or video/webm.");

    const created = await this.create(
      { ...params, filename, content_type: contentType, size_bytes: size },
      { idempotencyKey: options.idempotencyKey, signal: options.signal },
    );

    // The signed URL carries its own credentials: never send the API key to it.
    const response = await this.http.fetchImpl(created.upload_url, {
      method: "PUT",
      headers: { "Content-Type": contentType, "Content-Length": String(size) },
      body: withProgress(resolved.stream, size, options.onProgress),
      signal: options.signal,
      // Required by fetch for streaming request bodies.
      duplex: "half",
    } as RequestInit);
    if (!response.ok) {
      throw new APIError(response.status, "upload_failed", `Upload to the signed URL failed with status ${response.status}.`);
    }
    return this.complete(created.video.id, { signal: options.signal });
  }

  /** Polls until the video is decided, failed or deleted. Throws `TimeoutError` when time runs out. */
  async waitForDecision(videoId: string, options: WaitOptions = {}): Promise<Video> {
    const deadline = Date.now() + (options.timeoutMs ?? 600_000);
    const maxInterval = options.maxIntervalMs ?? 15_000;
    let interval = options.initialIntervalMs ?? 1000;
    for (;;) {
      const video = await this.get(videoId, { signal: options.signal });
      if (TERMINAL_STATUSES.has(video.status)) return video;
      const remaining = deadline - Date.now();
      if (remaining <= 0) {
        throw new TimeoutError(`Video ${videoId} was still "${video.status}" after the timeout.`);
      }
      // Full jitter keeps many waiting clients from polling in lockstep.
      await this.http.sleep(Math.min(remaining, interval * (0.5 + Math.random() / 2)), options.signal);
      interval = Math.min(maxInterval, interval * 1.5);
    }
  }
}

function contentTypeOf(declared: string | undefined, filename: string | undefined): CreateVideoRequest["content_type"] | undefined {
  if (declared && declared in invert(CONTENT_TYPES)) return declared as CreateVideoRequest["content_type"];
  const ext = filename?.split(".").pop()?.toLowerCase();
  return ext ? CONTENT_TYPES[ext] : undefined;
}

function invert(map: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(map).map(([k, v]) => [v, k]));
}

async function resolveSource(source: UploadSource): Promise<ResolvedSource> {
  if (typeof source === "string") {
    // Node only; the dynamic import keeps edge bundles free of node: modules.
    const [{ createReadStream }, { stat }, { Readable }, { basename }] = await Promise.all([
      import("node:fs"),
      import("node:fs/promises"),
      import("node:stream"),
      import("node:path"),
    ]);
    const info = await stat(source);
    return {
      stream: Readable.toWeb(createReadStream(source)) as unknown as ReadableStream<Uint8Array>,
      size: info.size,
      filename: basename(source),
    };
  }
  if (source instanceof Uint8Array) return { stream: bytesToStream(source), size: source.byteLength };
  if (source instanceof ArrayBuffer) return { stream: bytesToStream(new Uint8Array(source)), size: source.byteLength };
  if (typeof Blob !== "undefined" && source instanceof Blob) {
    return {
      stream: source.stream() as ReadableStream<Uint8Array>,
      size: source.size,
      filename: (source as File).name,
      contentType: source.type,
    };
  }
  return { stream: source as ReadableStream<Uint8Array> };
}

const CHUNK_BYTES = 1 << 20;

function bytesToStream(bytes: Uint8Array): ReadableStream<Uint8Array> {
  let offset = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (offset >= bytes.byteLength) return controller.close();
      controller.enqueue(bytes.subarray(offset, offset + CHUNK_BYTES));
      offset += CHUNK_BYTES;
    },
  });
}

function withProgress(
  stream: ReadableStream<Uint8Array>,
  total: number,
  onProgress?: (progress: UploadProgress) => void,
): ReadableStream<Uint8Array> {
  if (!onProgress) return stream;
  let sent = 0;
  return stream.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        controller.enqueue(chunk);
        sent += chunk.byteLength;
        onProgress({ bytesUploaded: sent, totalBytes: total });
      },
    }),
  );
}
