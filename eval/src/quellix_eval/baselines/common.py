"""Shared machinery for general-model baselines (Gemini, TwelveLabs Pegasus).

A baseline sends clip + rubric task to a general video model, asks for *measurements* in the
worker's measurement contract, and lets `quellix_worker.rubric.evaluate` decide, so the only
difference between engines is who produced the measurements. Clients are injectable: tests
never touch the network.
"""

from __future__ import annotations

import json
import re
from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Protocol

import av
from quellix_worker.rubric import CHECK_NAMES, CheckOutput, evaluate


@dataclass(frozen=True)
class ModelResponse:
    text: str
    cost_usd: float
    input_tokens: int = 0
    output_tokens: int = 0


class VideoModelClient(Protocol):
    """Anything that can answer a prompt about a video file."""

    name: str

    def generate(self, video_path: Path, prompt: str) -> ModelResponse: ...


def build_prompt(rubric: Mapping[str, Any]) -> str:
    task = rubric.get("task", {})
    return (
        "You are inspecting a first-person (egocentric) video. Return ONLY a JSON object with "
        "these keys, all measurements, no verdicts:\n"
        '{"hands_visible": {"ratio_both_manipulation": 0-1, "ratio_any_manipulation": 0-1, '
        '"ratio_both_whole": 0-1, "ratio_any_whole": 0-1},\n'
        ' "framing": {"off_target_ratio": 0-1, "unstable_ratio": 0-1},\n'
        ' "task_completed": {"completed": true|false|null, "confidence": 0-1},\n'
        ' "privacy": {"faces": [{"t_s": s}], "documents": [{"t_s": s}], "screens": [{"t_s": s}]},\n'
        ' "technical": {"blur_ratio": 0-1, "bad_exposure_ratio": 0-1}}\n'
        "Hands visible = fully visible, wrist to fingertips, not cut by the frame edge. "
        "Ratios are shares of the video time.\n"
        f"Task: {task.get('description', '')}\n"
        f"Steps: {json.dumps(task.get('steps', []))}\n"
        f"Final state: {task.get('final_state', '')}"
    )


_JSON = re.compile(r"\{.*\}", re.S)


def parse_measurements(text: str) -> dict[str, Any]:
    m = _JSON.search(text)
    if not m:
        raise ValueError("no JSON object in model answer")
    data = json.loads(m.group(0))
    if not isinstance(data, dict):
        raise ValueError("model answer is not a JSON object")
    return data


def probe_technical(video_path: Path) -> dict[str, Any]:
    """Container facts a model cannot be trusted with: measured locally, not guessed."""
    try:
        with av.open(str(video_path)) as c:
            s = c.streams.video[0]
            duration = float(c.duration / 1_000_000) if c.duration else 0.0
            return {
                "decodable": True,
                "duration_s": duration,
                "width": s.codec_context.width,
                "height": s.codec_context.height,
                "fps": float(s.average_rate or 0),
            }
    except Exception:  # noqa: BLE001 - any decode failure means not decodable
        return {"decodable": False}


def to_outputs(
    data: Mapping[str, Any], model: str, technical_probe: Mapping[str, Any]
) -> dict[str, CheckOutput]:
    outputs: dict[str, CheckOutput] = {}
    for name in CHECK_NAMES:
        if name == "technical":
            meas = {**dict(data.get("technical") or {}), **technical_probe}
        elif name == "originality":
            # No per-customer fingerprint store in a baseline: it cannot detect duplicates.
            meas = {"max_similarity": 0.0, "match_video_id": None}
        else:
            meas = data.get(name)
        if not isinstance(meas, Mapping):
            outputs[name] = CheckOutput(
                error="missing from model answer", model=f"baseline:{model}"
            )
        else:
            outputs[name] = CheckOutput(measurements=meas, model=f"baseline:{model}")
    return outputs


@dataclass(frozen=True)
class BaselineResult:
    decision: dict[str, Any]
    cost_usd: float


def run_baseline(
    client: VideoModelClient, video_path: Path, rubric: Mapping[str, Any], video_id: str
) -> BaselineResult:
    """clip + rubric -> measurements (general model) -> decision (worker's rubric.evaluate)."""
    probe = probe_technical(video_path)
    resp = client.generate(video_path, build_prompt(rubric))
    try:
        outputs = to_outputs(parse_measurements(resp.text), client.name, probe)
    except ValueError as e:  # JSONDecodeError is a ValueError
        outputs = {n: CheckOutput(error=f"unparseable model answer: {e}", model=client.name)
                   for n in CHECK_NAMES}
        outputs["technical"] = CheckOutput(measurements=probe, model="probe")
    return BaselineResult(evaluate(video_id, rubric, outputs), resp.cost_usd)
