# @ormes/sdk

TypeScript SDK for the [Ormes](https://ormes.ai) API. Zero runtime dependencies, ESM + CJS, Node 20+ and edge runtimes (it only uses `fetch` and Web Crypto).

```bash
npm install @ormes/sdk   # not published yet: build from this folder for now
```

## Quickstart

```ts
import { Ormes } from "@ormes/sdk";

const ormes = new Ormes(); // ORMES_API_KEY, optional ORMES_BASE_URL

const video = await ormes.videos.upload("./clip.mp4", { rubric_id: "rub_123" });
const decided = await ormes.videos.waitForDecision(video.id);
console.log(decided.decision?.decision, decided.decision?.reasons);
```

## API

| Call | Notes |
|---|---|
| `videos.create(params)` | Returns `{ video, upload_url, upload_expires_at }`. Sends an `Idempotency-Key` (pass your own with `{ idempotencyKey }`). |
| `videos.upload(source, params, { onProgress })` | create + `PUT` + complete. `source` is a file path (Node), `Blob`/`File`, `Uint8Array`, `ArrayBuffer` or a `ReadableStream` (then pass `size_bytes`). Filename, size and type are inferred when possible. Not retried. |
| `videos.complete(id)`, `videos.get(id)` | |
| `videos.list(params)` | Async iterator over every page: `for await (const v of ormes.videos.list({ status: "decided" }))`. `listPage` returns one page. |
| `videos.waitForDecision(id, { timeoutMs })` | Polls with growing, jittered intervals until `decided`, `failed` or `deleted`. Throws `TimeoutError`. |
| `review.submit(id, { decision, note })` | |
| `labOutcome.submit(id, { outcome, reason })` | |
| `rubrics.create / get / list / newVersion` | `newVersion` is `PUT /rubrics/{id}`. |
| `contributorFeedback(decision)` | What to fix and where, ready to show the person who filmed the video: `FeedbackItem[]` (`check`, `code`, `effect`, `message`, `hint`, `segments`). Only reasons the contributor may see, ordered by time; duplicates and other hidden rejections become one generic message. |
| `webhooks.verifySignature(payload, header, secret)` | Constant-time. Returns a boolean. `webhooks.constructEvent` throws `WebhookSignatureError` or returns the typed event. |

Errors: `AuthenticationError`, `NotFoundError`, `ValidationError` (`fields`), `RateLimitError` (`retryAfter` seconds), `APIError` (base, with `status`, `code`, `requestId`), plus `ConnectionError` and `TimeoutError`. 429 and 5xx responses are retried with jitter (`maxRetries`, default 2); a `POST` without an idempotency key is only retried on 429.

## Webhooks

Pass the **raw** request body. Signatures are accepted as `t=<unix>,v1=<hex>` (signed over `"<t>.<body>"`, 5 minute tolerance, configurable) or as the bare hex HMAC the API sends today. See `examples/express-webhook.mjs`.

## Development

```bash
pnpm install
pnpm generate          # regenerate src/generated/schema.d.ts from packages/contracts/openapi.yaml
pnpm lint && pnpm typecheck && pnpm test && pnpm build
```

CI fails if `src/generated` is out of date (`pnpm check:generated`).
