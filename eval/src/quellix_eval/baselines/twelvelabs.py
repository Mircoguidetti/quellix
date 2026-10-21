"""TwelveLabs Pegasus baseline. Needs `pip install .[twelvelabs]` and TWELVELABS_API_KEY."""

from __future__ import annotations

import os
from pathlib import Path

import av

from ..prices import price
from .common import ModelResponse


def twelvelabs_cost(duration_s: float) -> float:
    return duration_s / 3600 * price("pegasus_per_video_hour")


def _duration_s(path: Path) -> float:
    with av.open(str(path)) as c:
        return float(c.duration / 1_000_000) if c.duration else 0.0


class TwelveLabsClient:  # pragma: no cover - network
    name = "pegasus"

    def __init__(self, api_key: str | None = None) -> None:
        from twelvelabs import TwelveLabs

        self._client = TwelveLabs(api_key=api_key or os.environ["TWELVELABS_API_KEY"])

    def generate(self, video_path: Path, prompt: str) -> ModelResponse:
        # Uploads an asset and calls the analyze endpoint; adapt here if the SDK changes.
        with open(video_path, "rb") as fh:
            asset = self._client.assets.create(method="direct", file=fh)
        r = self._client.analyze(video={"type": "asset_id", "asset_id": asset.id}, prompt=prompt)
        text = r.data or ""
        tout = max(1, len(text) // 4)
        return ModelResponse(text, twelvelabs_cost(_duration_s(video_path)), 0, tout)
