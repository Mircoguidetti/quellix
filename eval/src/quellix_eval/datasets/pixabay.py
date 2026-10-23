"""Pixabay videos (Pixabay Content License: free use, no attribution required) for the viewpoint
test set (#79). Search through the official API (`PIXABAY_API_KEY`), download one rendition in
the Actions job; videos are never committed, only ids and labels.

API: https://pixabay.com/api/docs/#api_search_videos
"""

from __future__ import annotations

import json
import time
import urllib.error
import urllib.parse
from collections.abc import Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Any

API = "https://pixabay.com/api/videos/"
# The API allows 100 requests per 60 s per key (#83: a run of ~140 calls got HTTP 429): with
# Throttled, one call every MIN_INTERVAL_S stays under it and a 429 is retried after a pause.
MIN_INTERVAL_S = 0.7
RETRIES_429 = 5
PAUSE_429_S = 20.0
LICENSE = "Pixabay Content License"
# The rendition to fetch: the worker decodes at 480 px anyway, so the smallest one >= 480 px.
PREFERRED = ("small", "medium", "tiny", "large")


@dataclass(frozen=True)
class Hit:
    pixabay_id: int
    page: str
    tags: str
    duration_s: float
    url: str
    width: int
    height: int
    query: str

    @property
    def clip_id(self) -> str:
        return f"pixabay_{self.pixabay_id}"


def pick_rendition(videos: dict[str, Any]) -> tuple[str, int, int] | None:
    """(url, width, height) of the smallest rendition with a short side >= 360 px."""
    options = [(name, v) for name in PREFERRED if (v := videos.get(name)) and v.get("url")]
    good = [(n, v) for n, v in options if min(int(v.get("width") or 0),
                                               int(v.get("height") or 0)) >= 360]
    chosen = (good or options)[:1]
    if not chosen:
        return None
    v = chosen[0][1]
    return str(v["url"]), int(v.get("width") or 0), int(v.get("height") or 0)


def parse_hits(raw: bytes | str, query: str, max_duration_s: float = 60.0) -> list[Hit]:
    data = json.loads(raw)
    out = []
    for h in data.get("hits", []):
        r = pick_rendition(h.get("videos") or {})
        if r is None or float(h.get("duration") or 0) > max_duration_s:
            continue
        out.append(Hit(int(h["id"]), str(h.get("pageURL") or ""), str(h.get("tags") or ""),
                       float(h.get("duration") or 0), r[0], r[1], r[2], query))
    return out


def search_url(key: str, query: str, per_page: int = 20, page: int = 1) -> str:
    q = urllib.parse.urlencode({"key": key, "q": query[:100], "per_page": max(3, per_page),
                                "page": page, "video_type": "film", "safesearch": "true"})
    return f"{API}?{q}"


def search(net, key: str, queries: Sequence[str], per_query: int,
           skip: set[int] | None = None) -> list[Hit]:
    """Up to `per_query` new hits per query, in query order, without duplicates."""
    seen = set(skip or ())
    out: list[Hit] = []
    for q in queries:
        taken = 0
        for hit in parse_hits(net.get(search_url(key, q, per_page=max(per_query * 2, 10))), q):
            if hit.pixabay_id in seen or taken >= per_query:
                continue
            seen.add(hit.pixabay_id)
            out.append(hit)
            taken += 1
    return out


def download(net, hit: Hit, out_dir: Path) -> Path:
    dst = out_dir / f"{hit.clip_id}.mp4"
    net.download(hit.url, dst)
    if dst.stat().st_size < 20_000:
        raise RuntimeError(f"file too small ({dst.stat().st_size} bytes)")
    return dst


def by_id(net, key: str, pixabay_id: int) -> Hit | None:
    """The hit for one video id (download URLs expire, so they are looked up again)."""
    q = urllib.parse.urlencode({"key": key, "id": pixabay_id})
    hits = parse_hits(net.get(f"{API}?{q}"), "", max_duration_s=1e9)
    return hits[0] if hits else None


class Throttled:
    """Wraps a net: API calls (``get``) at most one per ``interval`` s, a 429 retried after a
    pause. Downloads from the CDN are not rate limited and pass through."""

    def __init__(self, inner: Any, interval: float = MIN_INTERVAL_S, retries: int = RETRIES_429,
                 pause: float = PAUSE_429_S, sleep: Any = time.sleep,
                 clock: Any = time.monotonic) -> None:
        self.inner, self.interval, self.retries, self.pause = inner, interval, retries, pause
        self.sleep, self.clock = sleep, clock
        self._last = -1e9

    def get(self, url: str, headers: dict[str, str] | None = None) -> bytes:
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

    def download(self, url: str, dst: Path, headers: dict[str, str] | None = None) -> None:
        self.inner.download(url, dst)
