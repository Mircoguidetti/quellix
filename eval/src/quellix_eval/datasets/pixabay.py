"""Pixabay videos (Pixabay Content License: free commercial use, no attribution required).

Used for the privacy check's real-face test set (#83): clips found by a search query, kept by
id so a later job downloads exactly the same files. Needs the `PIXABAY_API_KEY` secret; the
videos are downloaded when a job needs them and never committed.

API: https://pixabay.com/api/docs/#api_search_videos
"""

from __future__ import annotations

import json
import time
import urllib.error
import urllib.parse
import urllib.request
from collections.abc import Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Protocol

# The API allows 100 requests per 60 s per key: one call every MIN_INTERVAL_S stays under it,
# and a 429 is retried after a pause.
MIN_INTERVAL_S = 0.7
RETRIES_429 = 5
PAUSE_429_S = 20.0

API = "https://pixabay.com/api/videos/"
LICENSE = "Pixabay Content License"
UA = "quellix-eval/0.1 (+https://github.com/Mircoguidetti/quellix)"
# Smallest rendition first: the worker downscales to 480 px anyway.
RENDITIONS = ("small", "medium", "tiny", "large")
MAX_DURATION_S = 40


class Net(Protocol):
    def get(self, url: str) -> bytes: ...

    def download(self, url: str, dst: Path) -> None: ...


class UrllibNet:  # pragma: no cover - network
    def __init__(self, timeout: float = 120.0) -> None:
        self.timeout = timeout

    def get(self, url: str) -> bytes:
        req = urllib.request.Request(url, headers={"User-Agent": UA})
        with urllib.request.urlopen(req, timeout=self.timeout) as r:  # noqa: S310 - https only
            return r.read()

    def download(self, url: str, dst: Path) -> None:
        dst.parent.mkdir(parents=True, exist_ok=True)
        dst.write_bytes(self.get(url))


class Throttled:
    """Wraps a Net: API calls (``get``) at most one per ``interval`` s, a 429 retried after a
    pause. Downloads from the CDN are not rate limited and pass through."""

    def __init__(self, inner: Net, interval: float = MIN_INTERVAL_S, retries: int = RETRIES_429,
                 pause: float = PAUSE_429_S, sleep: Any = time.sleep,
                 clock: Any = time.monotonic) -> None:
        self.inner, self.interval, self.retries, self.pause = inner, interval, retries, pause
        self.sleep, self.clock = sleep, clock
        self._last = -1e9

    def get(self, url: str) -> bytes:
        for attempt in range(self.retries + 1):
            wait = self._last + self.interval - self.clock()
            if wait > 0:
                self.sleep(wait)
            self._last = self.clock()
            try:
                return self.inner.get(url)
            except urllib.error.HTTPError as e:
                if e.code != 429 or attempt == self.retries:
                    raise
                self.sleep(self.pause * (attempt + 1))
        raise AssertionError("unreachable")

    def download(self, url: str, dst: Path) -> None:
        self.inner.download(url, dst)


@dataclass(frozen=True)
class Hit:
    pixabay_id: int
    page_url: str
    tags: str
    duration_s: float
    video_url: str
    width: int
    height: int

    @property
    def clip_id(self) -> str:
        return f"pixabay_{self.pixabay_id}"


def parse_hit(h: dict[str, Any]) -> Hit | None:
    videos = h.get("videos") or {}
    for name in RENDITIONS:
        v = videos.get(name) or {}
        if v.get("url"):
            return Hit(int(h["id"]), str(h.get("pageURL", "")), str(h.get("tags", "")),
                       float(h.get("duration") or 0), str(v["url"]), int(v.get("width") or 0),
                       int(v.get("height") or 0))
    return None


def _query(key: str, **params: Any) -> str:
    return API + "?" + urllib.parse.urlencode({"key": key, "safesearch": "true", **params})


def search(net: Net, key: str, q: str, n: int, exclude: Sequence[int] = (),
           video_type: str = "film") -> list[Hit]:
    """The first ``n`` usable hits for ``q`` (short clips only, ids in ``exclude`` skipped).
    ``video_type="film"`` leaves out animations (cartoon faces are not faces)."""
    data = json.loads(net.get(_query(key, q=q, per_page=max(3, min(200, 4 * n)),
                                     video_type=video_type)))
    out: list[Hit] = []
    for h in data.get("hits") or []:
        hit = parse_hit(h)
        if hit is None or hit.pixabay_id in exclude or hit.duration_s > MAX_DURATION_S:
            continue
        out.append(hit)
        if len(out) >= n:
            break
    return out


def by_id(net: Net, key: str, pixabay_id: int) -> Hit:
    data = json.loads(net.get(_query(key, id=pixabay_id)))
    hits = [h for h in (parse_hit(x) for x in data.get("hits") or []) if h]
    if not hits:
        raise RuntimeError(f"pixabay {pixabay_id}: not found")
    return hits[0]


def fetch(net: Net, hit: Hit, out_dir: Path) -> Path:
    dst = out_dir / "pixabay-raw" / f"{hit.clip_id}.mp4"
    if not dst.exists() or dst.stat().st_size < 10_000:
        net.download(hit.video_url, dst)
    return dst
