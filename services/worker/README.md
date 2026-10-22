# services/worker

The Ormes video pipeline (decode, checks, rubric evaluation, decision). Runs on Modal.
See `CLAUDE.md` for the architecture and the measurement contract.

## Local

```bash
uv sync && uv run ruff check . && uv run pytest
uv run python -m quellix_worker check video.mp4 --rubric rubric.json
```

## How a video becomes a decision

`POST /v1/videos/{id}/complete` (web) inserts a `jobs` row and sends `{job_id, video_id}` to the
pgmq queue `video_jobs`. On Modal:

1. `poller` (every minute, CPU) reads the queue through `pgmq_public` and spawns one `process`
   container per message.
2. `process` downloads the file from the private `videos` bucket, runs the pipeline, writes the
   `decisions` row (decision, reasons, every measurement, rubric id + version), sets the video to
   `decided`, deletes the file (`storage_path = null`, `file_deleted_at`) unless the decision is
   `review` (see Data retention), records
   `jobs.cost_usd`, sends the signed `video.decided` webhook and archives the message.
3. A failed attempt is retried (the message is re-sent after 60 s, then 300 s). After the third
   failure the job and the video are `failed` with the error in `jobs.error`, the customer file
   is deleted, and the message is archived; nothing is decided and nothing is silently rejected.
4. The webhook carries `Ormes-Signature: t=<unix>,v1=<hex HMAC-SHA256 of "<t>.<raw body>">`
   (see `openapi.yaml`), signed with `webhooks.signing_secret`.

Containers scale to zero. The default is CPU (2 cores, 4 GiB); a GPU is opt-in (below).

## Deploy (founder, once)

1. Create a Modal account and an API token (Settings > API Tokens).
2. Create the Modal secret the app reads (values from Supabase > Project Settings > API):

   ```bash
   modal secret create quellix-supabase \
     SUPABASE_URL=https://<project>.supabase.co \
     SUPABASE_SERVICE_ROLE_KEY=<service role key>
   ```

   Optional keys can go in the same secret: `QUELLIX_COMPUTE_USD_PER_SECOND`,
   `QUELLIX_ALLOW_EXTERNAL_MODELS`, `GEMINI_API_KEY`, ... (see `.env.example`).
3. Add GitHub repository secrets `MODAL_TOKEN_ID` and `MODAL_TOKEN_SECRET` (deploy), and
   `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` (smoke test).
4. Make sure the migrations are applied and `pgmq_public` is in the API's exposed schemas
   (`supabase/config.toml`).

`.github/workflows/worker.yml` deploys on every push to `main` under `services/worker/**` (or
manually from the Actions tab), then runs `scripts/smoke_test.py`. If a secret is missing the
workflow ends green with a notice saying what to add.

**GPU (optional):** set the repository variable `QUELLIX_WORKER_GPU` (for example `T4`) and
redeploy. That installs torch/transformers and enables the DINOv2 embedder.

**Cost:** set `QUELLIX_COMPUTE_USD_PER_SECOND` in the Modal secret to the price of one second of
the function's compute (modal.com/pricing); otherwise only API spend is recorded.

## Smoke test

`scripts/smoke_test.py` creates a test org (`quellix-smoke-test`), uploads a generated clip,
enqueues it, waits up to 5 minutes, asserts a schema-valid decision and that the file was deleted,
and cleans up. Run it by hand with `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` set.

## Data retention

Founder rule (root `CLAUDE.md`): we keep what surrounds the video, not the video.

- **accept / reject:** the file is deleted right after the decision is written.
- **review:** the file is kept so a person can watch it; `videos.delete_after = now + 14 days`.
  It is deleted when a review decision is recorded (the web review screen does this) or when
  `delete_after` passes: the Modal function `retention_sweep` runs daily at 03:17 UTC and deletes
  expired files and kept files that already have a review row.
- **final processing failure:** the file is deleted after the last attempt.
- **kept per customer, never deleted by the worker:** decisions, reasons, every measurement,
  rubric versions, reviewer overrides with their note, lab outcomes, fingerprints. The worker only
  ever deletes Storage objects and queue messages (asserted by a test).
