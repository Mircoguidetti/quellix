"""Gemini baseline. Needs `pip install .[gemini]` and GEMINI_API_KEY (not used in tests)."""

from __future__ import annotations

import os
import time
from pathlib import Path

from ..prices import price
from .common import ModelResponse


def gemini_cost(input_tokens: int, output_tokens: int) -> float:
    return (
        input_tokens * price("gemini_in_per_m_tokens")
        + output_tokens * price("gemini_out_per_m_tokens")
    ) / 1_000_000


class GeminiClient:  # pragma: no cover - network
    def __init__(self, model: str | None = None, api_key: str | None = None) -> None:
        from google import genai

        self.name = model or os.environ.get("GEMINI_MODEL", "gemini-2.5-pro")
        self._genai = genai
        self._client = genai.Client(api_key=api_key or os.environ["GEMINI_API_KEY"])

    def generate(self, video_path: Path, prompt: str) -> ModelResponse:
        f = self._client.files.upload(file=str(video_path))
        while getattr(f.state, "name", "ACTIVE") == "PROCESSING":
            time.sleep(2)
            f = self._client.files.get(name=f.name)
        r = self._client.models.generate_content(model=self.name, contents=[f, prompt])
        u = r.usage_metadata
        tin, tout = u.prompt_token_count or 0, u.candidates_token_count or 0
        return ModelResponse(r.text or "", gemini_cost(tin, tout), tin, tout)
