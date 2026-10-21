"""Use the cheapest Gemini model the key can actually use.

Models are tried cheapest first. A model is dropped for the rest of the run when it has no free
quota (hard 429), does not exist for this key (404), or stays rate limited for two clips in a
row. The first raw 429 body is kept so the report can show the quota name and limit.
"""

from __future__ import annotations

from collections import Counter
from collections.abc import Callable, Sequence
from pathlib import Path

from .common import ModelResponse, VideoModelClient
from .retry import RetryingClient, is_hard_quota, is_model_unavailable, is_rate_limit


class FallbackClient:
    def __init__(
        self,
        models: Sequence[str],
        factory: Callable[[str], VideoModelClient],
        wrap: Callable[[VideoModelClient], RetryingClient],
        patience: int = 2,
    ) -> None:
        if not models:
            raise ValueError("no models to try")
        self.models = list(models)
        self.name = self.models[0]
        self._factory = factory
        self._wrap = wrap
        self._patience = patience
        self._index = 0
        self._client: RetryingClient | None = None
        self._rate_limited_in_a_row = 0
        self.first_rate_limit_body: str | None = None
        self.served: Counter[str] = Counter()
        self.dropped: dict[str, str] = {}      # model -> why it was dropped

    @property
    def current(self) -> str:
        return self.models[self._index]

    def _advance(self, why: str) -> bool:
        self.dropped[self.current] = why
        self._client = None
        self._rate_limited_in_a_row = 0
        if self._index + 1 >= len(self.models):
            return False
        self._index += 1
        self.name = self.current
        return True

    def generate(self, video_path: Path, prompt: str) -> ModelResponse:
        while True:
            if self._client is None:
                try:
                    self._client = self._wrap(self._factory(self.current))
                except Exception as e:  # noqa: BLE001 - cannot even build this model's client
                    if self._advance(f"client error: {e}"[:200]):
                        continue
                    raise
            client = self._client
            try:
                resp = client.generate(video_path, prompt)
            except Exception as e:  # noqa: BLE001
                if self.first_rate_limit_body is None:
                    self.first_rate_limit_body = client.first_rate_limit_body
                if is_model_unavailable(e):
                    if self._advance("not available for this key (404)"):
                        continue
                elif is_hard_quota(e):
                    if self._advance("no free quota (429)"):
                        continue
                elif is_rate_limit(e) and not isinstance(e, TimeoutError):
                    self._rate_limited_in_a_row += 1
                    if self._rate_limited_in_a_row >= self._patience and self._advance(
                        "rate limited after all retries"
                    ):
                        continue
                raise
            self._rate_limited_in_a_row = 0
            self.served[self.current] += 1
            return resp

    def describe(self) -> str:
        parts = [f"`{m}`: {self.served.get(m, 0)} clips served" for m in self.models
                 if self.served.get(m) or m in self.dropped or m == self.current]
        text = "Gemini models used: " + "; ".join(parts) + "."
        if self.dropped:
            text += " Dropped: " + "; ".join(f"`{m}` ({w})" for m, w in self.dropped.items()) + "."
        if self.first_rate_limit_body:
            text += f" First raw 429 body: `{' '.join(self.first_rate_limit_body.split())[:600]}`"
        return text
