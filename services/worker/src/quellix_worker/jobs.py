"""Process one queued job end to end (shared by the Modal function and local runs)."""

from __future__ import annotations

import tempfile
from pathlib import Path

from .checks.originality import FingerprintStore
from .pipeline import Dependencies, PipelineConfig, run_pipeline
from .store import Job, SupabaseStore


def process_job(store: SupabaseStore, job: Job, fingerprints: FingerprintStore,
                config: PipelineConfig, deps: Dependencies) -> str:
    """-> decision value. On failure the job is marked failed and the error re-raised."""
    ctx = store.load_context(job)
    store.start_job(job.job_id, ctx.attempts)
    store.set_video(job.video_id, status="processing")
    try:
        with tempfile.TemporaryDirectory() as tmp:
            path = store.download(ctx.storage_path, Path(tmp) / (ctx.filename or "video.mp4"))
            # Both the org setting and the global kill switch (config) must allow external models.
            cfg = PipelineConfig(**{**config.__dict__, "org_id": ctx.org_id,
                                    "allow_external_models": ctx.allow_external_models
                                    and config.allow_external_models})
            deps.fingerprints = fingerprints
            result = run_pipeline(path, ctx.rubric, job.video_id, cfg, deps)
        # Order matters: decision first, fingerprints, then delete the file.
        store.write_decision(ctx.org_id, result.decision)
        fingerprints.add(ctx.org_id, job.video_id, result.fingerprints)
        store.set_video(job.video_id, status="decided", duration_s=result.duration_s)
        store.delete_video_file(job.video_id, ctx.storage_path)
        store.finish_job(job.job_id, cost_usd=result.cost["total_usd"])
        store.send_webhooks(ctx.org_id, {
            "id": job.video_id, "status": "decided", "rubric_id": result.decision["rubric"]["id"],
            "rubric_version": result.decision["rubric"]["version"],
            "decision": result.decision})
        store.archive_job(job)
        return result.decision["decision"]
    except Exception as exc:
        store.finish_job(job.job_id, error=str(exc)[:500])
        store.set_video(job.video_id, status="failed")
        raise
