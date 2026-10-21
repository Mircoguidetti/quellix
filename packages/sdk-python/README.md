# quellix (Python SDK)

Python SDK for the [Quellix](https://quellix.ai) API. Python 3.10+, built on `httpx` and `pydantic`, sync and async clients, fully typed (`py.typed`).

```bash
pip install quellix   # not published yet: `uv sync` in this folder for now
```

## Quickstart

```python
from quellix import Quellix

quellix = Quellix()  # QUELLIX_API_KEY, optional QUELLIX_BASE_URL

video = quellix.videos.upload("clip.mp4", rubric_id="rub_123")
decided = quellix.videos.wait_for_decision(video.id)
print(decided.decision.decision, [r.message for r in decided.decision.reasons])
```

`AsyncQuellix` has the same API with `await` (`async with AsyncQuellix() as client:`; `async for video in client.videos.list():`).

## API

| Call | Notes |
|---|---|
| `videos.create(...)` | Returns `CreateVideoResponse(video, upload_url, upload_expires_at)`. Sends an `Idempotency-Key` (pass `idempotency_key=` to choose it). |
| `videos.upload(source, rubric_id=..., on_progress=...)` | create + `PUT` + complete. `source` is a path, bytes, a binary file object or an iterable of bytes (async: also an async iterable). Filename, size and type are inferred when possible; streams need `size_bytes`. Not retried. `on_progress(bytes_uploaded, total_bytes)`. |
| `videos.complete(id)`, `videos.get(id)` | |
| `videos.list(status=, decision=, limit=)` | Iterator over every page. `list_page` returns one page and the next cursor. |
| `videos.wait_for_decision(id, timeout=600)` | Polls with growing, jittered intervals until `decided`, `failed` or `deleted`. Raises `quellix.TimeoutError`. |
| `review.submit(id, decision=, note=)` | |
| `lab_outcome.submit(id, outcome=, reason=)` | |
| `rubrics.create / get / list / new_version` | Inputs are plain mappings; `new_version` is `PUT /rubrics/{id}`. |
| `verify_signature(payload, header, secret)` | Constant-time, returns a bool. `construct_event` raises `WebhookSignatureError` or returns a `VideoDecidedEvent`. Also on `client.webhooks`. |

Errors (all subclass `QuellixError`): `AuthenticationError`, `NotFoundError`, `ValidationError` (`.fields`), `RateLimitError` (`.retry_after` seconds), `APIError` (base: `.status`, `.code`, `.request_id`), `ConnectionError`, `TimeoutError`. 429 and 5xx responses are retried with jitter (`max_retries`, default 2); a `POST` without an idempotency key is only retried on 429.

## Webhooks

Pass the **raw** request body. Signatures are accepted as `t=<unix>,v1=<hex>` (signed over `"<t>.<body>"`, 5 minute tolerance, configurable) or as the bare hex HMAC the API sends today. See `examples/fastapi_webhook.py`.

## Development

```bash
uv sync
./scripts/generate.sh      # regenerate src/quellix/_generated from packages/contracts/openapi.yaml
uv run ruff check . && uv run mypy && uv run pytest
uv build
```

CI fails if `src/quellix/_generated` is out of date.
