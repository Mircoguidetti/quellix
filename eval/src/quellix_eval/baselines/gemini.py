"""Gemini baseline. Needs `pip install .[gemini]` and GEMINI_API_KEY (not used in tests)."""

from __future__ import annotations

import contextlib
import os
import time
from pathlib import Path

from ..prices import DEFAULT_GEMINI_MODEL, gemini_cost
from .common import ModelResponse


class GeminiClient:  # pragma: no cover - network
    def __init__(self, model: str | None = None, api_key: str | None = None) -> None:
        from google import genai

        self.name = model or os.environ.get("GEMINI_MODEL", DEFAULT_GEMINI_MODEL)
        self._genai = genai
        self._client = genai.Client(api_key=api_key or os.environ["GEMINI_API_KEY"])

    def generate(self, video_path: Path, prompt: str) -> ModelResponse:
        f = self._client.files.upload(file=str(video_path))
        try:
            waited = 0.0
            while getattr(f.state, "name", "ACTIVE") == "PROCESSING":
                if waited > 120:
                    raise TimeoutError("Gemini file processing took over 2 minutes")
                time.sleep(2)
                waited += 2
                f = self._client.files.get(name=f.name)
            if getattr(f.state, "name", "ACTIVE") == "FAILED":
                raise RuntimeError("Gemini could not process the video file")
            r = self._client.models.generate_content(model=self.name, contents=[f, prompt])
        finally:
            # keep the free-tier file store clean
            with contextlib.suppress(Exception):
                self._client.files.delete(name=f.name)
        u = r.usage_metadata
        tin = u.prompt_token_count or 0
        # Thinking tokens are billed as output.
        tout = (u.candidates_token_count or 0) + (getattr(u, "thoughts_token_count", 0) or 0)
        return ModelResponse(r.text or "", gemini_cost(self.name, tin, tout), tin, tout)
