"""Rate-limit handling for free-tier model APIs: pace calls, retry 429s, stop at a deadline.

One clip failing never fails the run: after the retries are used up (or the deadline passes)
`generate` raises, and `baseline_engine` records that clip as a failed run.
"""

from __future__ import annotations

import re
import time
from collections.abc import Callable
from pathlib import Path

from .common import ModelResponse, VideoModelClient


def is_rate_limit(exc: BaseException) -> bool:
    if getattr(exc, "code", None) == 429 or getattr(exc, "status_code", None) == 429:
        return True
    text = str(exc)
    return "429" in text or "RESOURCE_EXHAUSTED" in text or "rate limit" in text.lower()


def is_billing_problem(exc: BaseException) -> bool:
    """Credits depleted / billing not set up (HTTP 402). Waiting or another model won't fix it:
    the credits belong to the whole project."""
    if getattr(exc, "code", None) == 402 or getattr(exc, "status_code", None) == 402:
        return True
    return bool(re.search(r"\b402\b|prepay|credits are depleted|billing", str(exc), re.I))


def is_hard_quota(exc: BaseException) -> bool:
    """A 429 that waiting will not fix: no free quota for this model, or the daily cap is hit."""
    text = str(exc)
    return is_rate_limit(exc) and bool(
        re.search(r"limit:\s*0\b|PerDay|per day|free_tier.*limit", text, re.I)
    )


def is_model_unavailable(exc: BaseException) -> bool:
    """The model id is wrong or not enabled for this key."""
    if getattr(exc, "code", None) == 404 or getattr(exc, "status_code", None) == 404:
        return True
    text = str(exc)
    pattern = r"\b404\b.*not found|is not found|not supported"
    return "NOT_FOUND" in text or bool(re.search(pattern, text, re.I))


def retry_delay_s(exc: BaseException) -> float | None:
    """The server's suggested wait ("retry in 12.3s" / "retryDelay: 12s"), if it gave one."""
    m = re.search(r"retry(?: in|Delay\D{0,5})\s*([0-9]+(?:\.[0-9]+)?)\s*s", str(exc), re.I)
    return float(m.group(1)) if m else None


class RetryingClient:
    def __init__(
        self,
        inner: VideoModelClient,
        min_interval_s: float = 6.0,       # 10 requests/minute: inside the free tier
        max_retries: int = 5,
        base_backoff_s: float = 15.0,
        deadline_s: float | None = None,   # total wall-clock budget for this client
        sleep: Callable[[float], None] = time.sleep,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self.inner = inner
        self.name = inner.name
        self.min_interval_s = min_interval_s
        self.max_retries = max_retries
        self.base_backoff_s = base_backoff_s
        self._sleep = sleep
        self._clock = clock
        self._deadline = None if deadline_s is None else clock() + deadline_s
        self._last_call = float("-inf")
        self.retries = 0
        self.first_rate_limit_body: str | None = None

    def _out_of_time(self, extra: float = 0.0) -> bool:
        return self._deadline is not None and self._clock() + extra > self._deadline

    def generate(self, video_path: Path, prompt: str) -> ModelResponse:
        for attempt in range(self.max_retries + 1):
            if self._out_of_time():
                raise TimeoutError("time budget for this model is used up; clip skipped")
            wait = self._last_call + self.min_interval_s - self._clock()
            if wait > 0:
                self._sleep(wait)
            self._last_call = self._clock()
            try:
                return self.inner.generate(video_path, prompt)
            except Exception as e:  # noqa: BLE001
                billing = is_billing_problem(e)
                if not billing and not is_rate_limit(e):
                    raise
                if self.first_rate_limit_body is None:
                    self.first_rate_limit_body = str(e)[:2000]
                if billing or is_hard_quota(e) or attempt == self.max_retries:
                    raise
                delay = retry_delay_s(e) or self.base_backoff_s * 2**attempt
                if self._out_of_time(delay):
                    raise TimeoutError("rate limited and out of time budget") from e
                self.retries += 1
                self._sleep(delay)
        raise AssertionError("unreachable")
