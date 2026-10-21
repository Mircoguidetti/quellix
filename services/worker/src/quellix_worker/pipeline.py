"""Orchestration: decode once, run the checks, apply the rubric, validate the decision."""

from __future__ import annotations

import time
from collections.abc import Mapping
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from . import media
from .checks import framing, hands, originality, privacy, task_baseline, technical
from .contracts import validate_decision, validate_rubric
from .rubric import CheckOutput, evaluate

# Modal bills GPU per second; this is the rate recorded in jobs.cost_usd (override per env).
DEFAULT_GPU_USD_PER_SECOND = 0.000164  # ~ NVIDIA T4 on Modal


@dataclass
class PipelineConfig:
    sample_fps: float = media.DEFAULT_SAMPLE_FPS
    # Customer video goes to Gemini / TwelveLabs only when the organisation allows it.
    allow_external_models: bool = False
    gpu_usd_per_second: float = 0.0  # 0 on CPU-only runs; set from the Modal function
    org_id: str = "local"


@dataclass
class Dependencies:
    fingerprints: originality.FingerprintStore = field(
        default_factory=originality.InMemoryFingerprintStore)
    embedder: originality.Embedder | None = None
    hands_model: hands.HandsModel | None = None
    face_detector: Any | None = None
    task_judge: task_baseline.TaskJudge | None = None


@dataclass
class PipelineResult:
    decision: dict[str, Any]
    cost: dict[str, float]
    fingerprints: list[originality.FrameFingerprint]
    duration_s: float | None = None
    timings_ms: dict[str, int] = field(default_factory=dict)
    models: dict[str, str] = field(default_factory=dict)


def _critical_reject(rubric: Mapping[str, Any], outputs: dict[str, CheckOutput]) -> bool:
    """Would the checks run so far already reject? Asked of the rubric, never decided here."""
    partial = evaluate("-", rubric, outputs)
    return any(r["effect"] == "reject" and r["check"] in outputs for r in partial["reasons"])


def run_pipeline(
    video_path: str | Path,
    rubric: Mapping[str, Any],
    video_id: str,
    config: PipelineConfig | None = None,
    deps: Dependencies | None = None,
) -> PipelineResult:
    config = config or PipelineConfig()
    deps = deps or Dependencies()
    validate_rubric(dict(rubric))
    started = time.monotonic()
    api_cost = 0.0

    timings: dict[str, int] = {}

    def timed(name: str, fn):
        t0 = time.monotonic()
        try:
            return fn()
        finally:
            timings[name] = round((time.monotonic() - t0) * 1000)

    video = timed("decode", lambda: media.decode(video_path, config.sample_fps))
    outputs: dict[str, CheckOutput] = {
        "technical": timed("technical", lambda: technical.run(video))}
    fingerprints: list[originality.FrameFingerprint] = []

    if video.info.decodable:
        outputs["originality"], fingerprints = timed("originality", lambda: originality.run(
            video, config.org_id, deps.fingerprints, video_id, deps.embedder))
        outputs["privacy"] = timed("privacy", lambda: privacy.run(video, faces=deps.face_detector))
        outputs["framing"] = timed("framing", lambda: framing.run(video))
        outputs["hands_visible"] = timed("hands_visible",
                                         lambda: hands.run(video, deps.hands_model))

        # Expensive last, and only if nothing critical has already failed.
        if _critical_reject(rubric, outputs):
            outputs["task_completed"] = CheckOutput(
                error="skipped because a critical check already failed")
        elif deps.task_judge is None or not config.allow_external_models:
            outputs["task_completed"] = CheckOutput(
                error="no task model available for this organisation")
        else:
            outputs["task_completed"], api_cost = timed("task_completed", lambda: task_baseline.run(
                rubric, video.path, video.info.duration_s, deps.task_judge))

    decision = evaluate(video_id, rubric, outputs)
    validate_decision(decision)
    gpu_cost = (time.monotonic() - started) * config.gpu_usd_per_second
    cost = {"gpu_usd": round(gpu_cost, 6), "api_usd": round(api_cost, 6),
            "total_usd": round(gpu_cost + api_cost, 6)}
    models = {n: o.model for n, o in outputs.items() if o.model}
    return PipelineResult(decision, cost, fingerprints, video.info.duration_s, timings, models)
