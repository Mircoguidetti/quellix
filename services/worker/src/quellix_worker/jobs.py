"""Process one queued job end to end (shared by the Modal function and local runs).

Failure policy: a job is attempted up to ``MAX_ATTEMPTS`` times. A failed attempt puts the
job back on the queue with a delay; the last failure marks job and video ``failed`` with the
error. Nothing is ever turned into a silent reject.
"""

from __future__ import annotations

import contextlib
import logging
import tempfile
from pathlib import Path

from .checks.originality import FingerprintStore
from .pipeline import Dependencies, PipelineConfig, run_pipeline
from .store import MAX_ATTEMPTS, RETRY_DELAYS_S, Job, JobContext, SupabaseStore

log = logging.getLogger(__name__)


def _video_payload(ctx: JobContext, decision: dict) -> dict:
    """The ``Video`` object of the OpenAPI contract (webhook ``data``)."""
    return {
        "id": ctx.job.video_id,
        "external_id": ctx.external_id,
        "status": "decided",
        "rubric_id": decision["rubric"]["id"],
        "rubric_version": decision["rubric"]["version"],
        "decision": decision,
        "review": None,
        "lab_outcome": None,
        "created_at": ctx.video_created_at,
    }


def _fail_or_retry(store: SupabaseStore, job: Job, attempts_used: int, error: str,
                   mark_video: bool) -> None:
    message = error[:500]
    if attempts_used < MAX_ATTEMPTS:
        delay = RETRY_DELAYS_S[min(attempts_used - 1, len(RETRY_DELAYS_S) - 1)]
        log.warning("job %s attempt %d failed (%s); retry in %ds", job.job_id, attempts_used,
                    message, delay)
        store.retry_job(job.job_id, message)
        if mark_video:
            store.set_video(job.video_id, status="queued")
        store.requeue_job(job, delay)
        return
    log.error("job %s failed after %d attempts: %s", job.job_id, attempts_used, message)
    store.finish_job(job.job_id, error=message)
    if mark_video:
        store.set_video(job.video_id, status="failed")
    # A pilot's signed source_url is the collector's credential: forgotten once we give up.
    with contextlib.suppress(Exception):
        store.forget_source_url(job.video_id)
    # Customer videos are deleted after analysis, also when the analysis failed for good
    # (unless the decision was already written as `review` and the file is kept for a person).
    try:
        path, delete_after = store.video_retention(job.video_id)
        if path and not delete_after:
            store.delete_video_file(job.video_id, path)
    except Exception:
        log.exception("could not delete the file of failed video %s", job.video_id)
    store.archive_job(job)


def process_job(store: SupabaseStore, job: Job, fingerprints: FingerprintStore,
                config: PipelineConfig, deps: Dependencies) -> str:
    """-> decision value, ``"skipped"`` for a duplicate delivery, or ``"retry"`` / ``"failed"``
    when the attempt failed (the failure is recorded, not raised)."""
    attempts_used = 1
    decided = False
    try:
        ctx = store.load_context(job)
        attempts_used = ctx.attempts + 1
        store.start_job(job.job_id, ctx.attempts)  # counts the attempt even if it fails early
        if ctx.video_status in ("decided", "deleted"):
            # Duplicate delivery or a retry after the decision was written: finish cleanup,
            # keeping the file only for a `review` decision.
            if ctx.storage_path and not ctx.delete_after:
                if store.latest_decision(job.video_id) == "review":
                    store.keep_for_review(job.video_id)
                else:
                    store.delete_video_file(job.video_id, ctx.storage_path)
            store.finish_job(job.job_id)
            store.archive_job(job)
            return "skipped"
        store.set_video(job.video_id, status="processing")
        with tempfile.TemporaryDirectory() as tmp:
            dest = Path(tmp) / (ctx.filename or "video.mp4")
            if ctx.storage_path:
                path = store.download(ctx.storage_path, dest)
            else:  # shadow pilot row pointing at the collector's own URL (issue #65)
                path = store.fetch_source(ctx.source_url or "", dest)
            # Both the org setting and the global kill switch (config) must allow external models.
            cfg = PipelineConfig(**{**config.__dict__, "org_id": ctx.org_id,
                                    "allow_external_models": ctx.allow_external_models
                                    and config.allow_external_models})
            deps.fingerprints = fingerprints
            result = run_pipeline(path, ctx.rubric, job.video_id, cfg, deps)
        # Order matters: decision first, then fingerprints, status, file deletion (accept/reject)
        # or retention (review), webhook.
        store.write_decision(ctx.org_id, result.decision)
        decided = True
        fingerprints.add(ctx.org_id, job.video_id, result.fingerprints)
        store.set_video(job.video_id, status="decided", duration_s=result.duration_s,
                        **({"source_url": None} if ctx.source_url else {}))
        if not ctx.storage_path:
            pass  # fetched from a URL into the temp dir, already gone: nothing stored to delete
        elif result.decision["decision"] == "review":
            store.keep_for_review(job.video_id)  # a person has to watch it; deleted <= 14 days
        else:
            store.delete_video_file(job.video_id, ctx.storage_path)
        store.finish_job(job.job_id, cost_usd=result.cost["total_usd"])
        try:
            # Shadow pilot videos (issue #65) never reach the customer's pipeline.
            if not ctx.shadow:
                store.send_webhooks(ctx.org_id, _video_payload(ctx, result.decision))
        except Exception:  # the decision is final; a webhook problem never fails the job
            log.exception("webhook delivery failed for video %s", job.video_id)
        store.archive_job(job)
        return result.decision["decision"]
    except Exception as exc:
        log.exception("job %s failed", job.job_id)
        # Once the decision exists the video stays `decided`; the retry only finishes cleanup.
        _fail_or_retry(store, job, attempts_used, f"{type(exc).__name__}: {exc}",
                       mark_video=not decided)
        return "retry" if attempts_used < MAX_ATTEMPTS else "failed"
