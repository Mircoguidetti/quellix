"""Task completion through general video models (Gemini, TwelveLabs Pegasus).

These are a baseline to beat, a teacher for labels and a fallback for tasks without a
specialised model. Never the product. The customer video is sent to a third party only
when the pipeline is told the organisation allows it (see pipeline.PipelineConfig).

NOTE: the HTTP calls follow the public REST docs of each provider but have not been run
against the live APIs from this environment (no keys, no network). The tests use mocks.
"""

from __future__ import annotations

import contextlib
import json
import os
import time
from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Protocol

import httpx

from ..rubric import CheckOutput

# --- prices used to record cost per call (USD). Update when the providers change them.
GEMINI_MODEL = "gemini-2.5-flash"
GEMINI_USD_PER_M_INPUT_TOKENS = 0.30
GEMINI_USD_PER_M_OUTPUT_TOKENS = 2.50
TWELVELABS_USD_PER_VIDEO_MINUTE = 0.04  # indexing + analysis estimate, per minute of video

JSON_FIELDS = (
    '{"completed": true|false|null, "confidence": 0..1, "start_s": number|null, '
    '"end_s": number|null, "steps": [{"name": string, "t_s": number}]}'
)


@dataclass(frozen=True)
class TaskJudgement:
    completed: bool | None
    confidence: float
    start_s: float | None = None
    end_s: float | None = None
    steps: tuple[dict[str, Any], ...] = ()
    cost_usd: float = 0.0
    model: str = ""

    def to_output(self) -> CheckOutput:
        m: dict[str, Any] = {"completed": self.completed, "confidence": self.confidence}
        if self.start_s is not None:
            m["start_s"] = self.start_s
        if self.end_s is not None:
            m["end_s"] = self.end_s
        if self.steps:
            m["steps"] = list(self.steps)
        return CheckOutput(measurements=m, model=self.model)


class TaskJudge(Protocol):
    name: str

    def judge(self, video_path: Path, prompt: str, duration_s: float | None) -> TaskJudgement: ...


def build_prompt(rubric: Mapping[str, Any]) -> str:
    task = rubric["task"]
    parts = [
        "You review a first-person (egocentric) video of a person doing a task.",
        f"Task: {task['description']}",
    ]
    if task.get("steps"):
        parts.append("Expected steps, in order:\n" + "\n".join(f"- {s}" for s in task["steps"]))
    if task.get("final_state"):
        parts.append(f"Expected final state: {task['final_state']}")
    parts.append(
        "Decide whether the task was fully completed in the video. If you cannot tell, use "
        "null and a low confidence; do not guess. Give times in seconds from the start of the "
        f"video. Answer with JSON only: {JSON_FIELDS}"
    )
    return "\n\n".join(parts)


def parse_judgement(text: str, cost_usd: float, model: str) -> TaskJudgement:
    data = json.loads(text.strip().removeprefix("```json").removesuffix("```").strip())
    completed = data.get("completed")
    if completed is not None and not isinstance(completed, bool):
        raise ValueError("'completed' must be true, false or null")
    confidence = min(max(float(data.get("confidence", 0.0)), 0.0), 1.0)
    return TaskJudgement(
        completed=completed,
        confidence=confidence,
        start_s=data.get("start_s"),
        end_s=data.get("end_s"),
        steps=tuple(data.get("steps") or ()),
        cost_usd=cost_usd,
        model=model,
    )


class GeminiJudge:
    name = "baseline:gemini"

    def __init__(self, api_key: str | None = None, client: httpx.Client | None = None,
                 model: str = GEMINI_MODEL, poll_s: float = 2.0) -> None:
        self._key = api_key or os.environ["GEMINI_API_KEY"]
        self._client = client or httpx.Client(timeout=300)
        self._model = model
        self._poll_s = poll_s

    def _upload(self, path: Path) -> dict[str, Any]:
        base = "https://generativelanguage.googleapis.com"
        start = self._client.post(
            f"{base}/upload/v1beta/files",
            headers={
                "x-goog-api-key": self._key,
                "X-Goog-Upload-Protocol": "resumable",
                "X-Goog-Upload-Command": "start",
                "X-Goog-Upload-Header-Content-Length": str(path.stat().st_size),
                "X-Goog-Upload-Header-Content-Type": "video/mp4",
            },
            json={"file": {"display_name": "video"}},
        )
        start.raise_for_status()
        done = self._client.post(
            start.headers["x-goog-upload-url"],
            headers={"X-Goog-Upload-Offset": "0", "X-Goog-Upload-Command": "upload, finalize"},
            content=path.read_bytes(),
        )
        done.raise_for_status()
        file = done.json()["file"]
        while file.get("state") == "PROCESSING":
            time.sleep(self._poll_s)
            r = self._client.get(f"{base}/v1beta/{file['name']}",
                                 headers={"x-goog-api-key": self._key})
            r.raise_for_status()
            file = r.json()
        if file.get("state") == "FAILED":
            raise RuntimeError("Gemini could not process the video")
        return file

    def judge(self, video_path: Path, prompt: str, duration_s: float | None) -> TaskJudgement:
        file = self._upload(video_path)
        body = {
            "contents": [{"parts": [
                {"file_data": {"mime_type": file.get("mimeType", "video/mp4"),
                               "file_uri": file["uri"]}},
                {"text": prompt},
            ]}],
            "generationConfig": {"responseMimeType": "application/json", "temperature": 0},
        }
        resp = self._client.post(
            f"https://generativelanguage.googleapis.com/v1beta/models/{self._model}:generateContent",
            headers={"x-goog-api-key": self._key}, json=body)
        resp.raise_for_status()
        data = resp.json()
        usage = data.get("usageMetadata", {})
        cost = (usage.get("promptTokenCount", 0) * GEMINI_USD_PER_M_INPUT_TOKENS
                + usage.get("candidatesTokenCount", 0) * GEMINI_USD_PER_M_OUTPUT_TOKENS) / 1e6
        with contextlib.suppress(httpx.HTTPError):  # drop the uploaded copy
            self._client.delete(f"https://generativelanguage.googleapis.com/v1beta/{file['name']}",
                                headers={"x-goog-api-key": self._key})
        text = data["candidates"][0]["content"]["parts"][0]["text"]
        return parse_judgement(text, cost, f"{self.name}:{self._model}")


class TwelveLabsJudge:
    name = "baseline:twelvelabs"

    def __init__(self, api_key: str | None = None, index_id: str | None = None,
                 client: httpx.Client | None = None, poll_s: float = 3.0) -> None:
        self._key = api_key or os.environ["TWELVELABS_API_KEY"]
        self._index = index_id or os.environ["TWELVELABS_INDEX_ID"]
        self._client = client or httpx.Client(timeout=600)
        self._poll_s = poll_s
        self._base = "https://api.twelvelabs.io/v1.3"

    def judge(self, video_path: Path, prompt: str, duration_s: float | None) -> TaskJudgement:
        h = {"x-api-key": self._key}
        with video_path.open("rb") as fh:
            task = self._client.post(f"{self._base}/tasks", headers=h,
                                     data={"index_id": self._index},
                                     files={"video_file": (video_path.name, fh, "video/mp4")})
        task.raise_for_status()
        task_id = task.json()["_id"]
        while True:
            r = self._client.get(f"{self._base}/tasks/{task_id}", headers=h)
            r.raise_for_status()
            state = r.json()
            if state["status"] == "ready":
                break
            if state["status"] == "failed":
                raise RuntimeError("TwelveLabs could not index the video")
            time.sleep(self._poll_s)
        video_id = state["video_id"]
        resp = self._client.post(f"{self._base}/analyze", headers=h, json={
            "video_id": video_id, "prompt": prompt, "temperature": 0, "stream": False})
        resp.raise_for_status()
        cost = TWELVELABS_USD_PER_VIDEO_MINUTE * (duration_s or 0.0) / 60.0
        with contextlib.suppress(httpx.HTTPError):  # drop the indexed copy
            self._client.delete(f"{self._base}/indexes/{self._index}/videos/{video_id}", headers=h)
        return parse_judgement(resp.json()["data"], cost, self.name)


def run(
    rubric: Mapping[str, Any], video_path: Path, duration_s: float | None, judge: TaskJudge
) -> tuple[CheckOutput, float]:
    """-> (output, api cost in USD). Any provider failure becomes an error (-> review)."""
    try:
        j = judge.judge(video_path, build_prompt(rubric), duration_s)
    except Exception as exc:
        return CheckOutput(error=f"{judge.name} failed: {exc}", model=judge.name), 0.0
    return j.to_output(), j.cost_usd
