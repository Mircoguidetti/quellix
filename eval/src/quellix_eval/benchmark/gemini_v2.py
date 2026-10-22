"""The strong general-model baseline of benchmark v2.

Gemini gets the full rubric JSON, the task and the measurement definitions (the exact text is
in `eval/prompts/benchmark_v2/`), answers through structured output (`schema.json`) with a
per-check `confidence`, and the decision is made by the worker's own `rubric.evaluate`, so the
only difference between engines is who measured. A check answered with confidence below
`MIN_CONFIDENCE` becomes "could not tell" (review), the same abstention rule as ours.
Every call is checked against a shared spend cap before it is made.
"""

from __future__ import annotations

import json
import threading
from collections.abc import Mapping
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Protocol

from quellix_worker.rubric import CHECK_NAMES, CheckOutput, evaluate

from ..baselines.common import ModelResponse, parse_measurements, probe_technical
from ..prices import gemini_cost

PROMPTS = Path(__file__).resolve().parents[3] / "prompts" / "benchmark_v2"
MIN_CONFIDENCE = 0.5
CHEAP_MODEL = "gemini-3.1-flash-lite"
STRONG_MODEL = "gemini-3.1-pro-preview"


def system_prompt() -> str:
    return (PROMPTS / "system.md").read_text()


def response_schema() -> dict[str, Any]:
    return json.loads((PROMPTS / "schema.json").read_text())


def user_prompt(rubric: Mapping[str, Any]) -> str:
    task = rubric.get("task", {})
    steps = task.get("steps") or []
    text = (PROMPTS / "user.md").read_text()
    # Plain replacement (not str.format): the prompt itself contains JSON braces.
    for key, value in {
        "{rubric_json}": json.dumps(rubric, indent=2, ensure_ascii=False),
        "{task_description}": str(task.get("description", "")),
        "{task_steps}": "; ".join(steps) if steps else "(not given)",
        "{task_final_state}": str(task.get("final_state") or "(not given)"),
    }.items():
        text = text.replace(key, value)
    return text


class StructuredClient(Protocol):
    name: str

    def generate(self, video_path: Path, system: str, prompt: str,
                 schema: Mapping[str, Any]) -> ModelResponse: ...


class SpendCapReached(RuntimeError):
    pass


@dataclass
class Budget:
    """A spend cap shared by every model of one job. A call is refused when the money left is
    less than the most expensive call seen so far for that model (or `first_guess_usd`), so the
    cap is not overshot by more than one unusually expensive call."""

    cap_usd: float
    first_guess_usd: Mapping[str, float] = field(default_factory=dict)
    # Optional per-model caps inside the total, so one model cannot starve another.
    model_caps: Mapping[str, float] = field(default_factory=dict)
    spent_usd: float = 0.0
    by_model: dict[str, float] = field(default_factory=dict)
    calls: dict[str, int] = field(default_factory=dict)
    refused: dict[str, int] = field(default_factory=dict)
    _max_call: dict[str, float] = field(default_factory=dict)
    _lock: threading.Lock = field(default_factory=threading.Lock)

    def reserve(self, model: str) -> None:
        with self._lock:
            need = self._max_call.get(model, self.first_guess_usd.get(model, 0.01))
            own = self.model_caps.get(model)
            if self.spent_usd + need > self.cap_usd or (
                    own is not None and self.by_model.get(model, 0.0) + need > own):
                self.refused[model] = self.refused.get(model, 0) + 1
                raise SpendCapReached(f"spend cap ${self.cap_usd:.2f} reached")

    def record(self, model: str, cost: float) -> None:
        with self._lock:
            self.spent_usd += cost
            self.by_model[model] = self.by_model.get(model, 0.0) + cost
            self.calls[model] = self.calls.get(model, 0) + 1
            self._max_call[model] = max(self._max_call.get(model, 0.0), cost)


def to_outputs(data: Mapping[str, Any], model: str,
               probe: Mapping[str, Any]) -> dict[str, CheckOutput]:
    out: dict[str, CheckOutput] = {}
    tag = f"baseline:{model}"
    for name in CHECK_NAMES:
        if name == "originality":
            # No per-customer fingerprint store in a baseline: it cannot detect duplicates.
            out[name] = CheckOutput(measurements={"max_similarity": 0.0, "match_video_id": None},
                                    model=tag)
            continue
        meas = data.get(name)
        if not isinstance(meas, Mapping):
            out[name] = CheckOutput(error="missing from model answer", model=tag)
            continue
        meas = {k: v for k, v in meas.items() if v is not None or k == "completed"}
        conf = meas.pop("confidence", None)
        if name == "technical":
            meas = {**meas, **probe}
        if not isinstance(conf, int | float) or conf < MIN_CONFIDENCE:
            out[name] = CheckOutput(error=f"low confidence ({conf})", model=tag)
            continue
        if name == "task_completed":
            meas["confidence"] = float(conf)
        if name == "hands_visible" and meas.get("manipulation_detected") is False:
            # Same rule as the worker: no manipulation seen is not evidence either way.
            for k in ("ratio_both_manipulation", "ratio_any_manipulation"):
                meas.pop(k, None)
        out[name] = CheckOutput(measurements=meas, model=tag)
    return out


def judge(client: StructuredClient, budget: Budget, video_path: Path,
          rubric: Mapping[str, Any], video_id: str) -> tuple[dict[str, Any], float]:
    """-> (decision, cost). Raises SpendCapReached before calling when the cap is reached."""
    budget.reserve(client.name)
    probe = probe_technical(video_path)
    resp = client.generate(video_path, system_prompt(), user_prompt(rubric), response_schema())
    budget.record(client.name, resp.cost_usd)
    try:
        outputs = to_outputs(parse_measurements(resp.text), client.name, probe)
    except ValueError as e:
        outputs = {n: CheckOutput(error=f"unparseable model answer: {e}", model=client.name)
                   for n in CHECK_NAMES}
        outputs["technical"] = CheckOutput(measurements=probe, model="probe")
    return evaluate(video_id, rubric, outputs), resp.cost_usd


class GeminiStructuredClient:  # pragma: no cover - network
    """google-genai with structured output, low media resolution, temperature 0."""

    def __init__(self, model: str, api_key: str | None = None) -> None:
        import os

        from google import genai

        self.name = model
        self._types = genai.types
        self._client = genai.Client(api_key=api_key or os.environ["GEMINI_API_KEY"])

    def generate(self, video_path: Path, system: str, prompt: str,
                 schema: Mapping[str, Any]) -> ModelResponse:
        import contextlib
        import time

        t = self._types
        f = self._client.files.upload(file=str(video_path))
        try:
            waited = 0.0
            while getattr(f.state, "name", "ACTIVE") == "PROCESSING":
                if waited > 180:
                    raise TimeoutError("Gemini file processing took over 3 minutes")
                time.sleep(2)
                waited += 2
                f = self._client.files.get(name=f.name)
            if getattr(f.state, "name", "ACTIVE") == "FAILED":
                raise RuntimeError("Gemini could not process the video file")
            cfg = t.GenerateContentConfig(
                system_instruction=system, temperature=0.0,
                response_mime_type="application/json", response_schema=dict(schema),
                media_resolution=t.MediaResolution.MEDIA_RESOLUTION_LOW)
            r = self._client.models.generate_content(model=self.name, contents=[f, prompt],
                                                     config=cfg)
        finally:
            with contextlib.suppress(Exception):
                self._client.files.delete(name=f.name)
        u = r.usage_metadata
        tin = u.prompt_token_count or 0
        tout = (u.candidates_token_count or 0) + (getattr(u, "thoughts_token_count", 0) or 0)
        return ModelResponse(r.text or "", gemini_cost(self.name, tin, tout), tin, tout)
