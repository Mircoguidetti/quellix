"""Pixabay videos (Pixabay Content License: free use, no attribution required) for the viewpoint
test set (#79). Search through the official API (`PIXABAY_API_KEY`), download one rendition in
the Actions job; videos are never committed, only ids and labels.

API: https://pixabay.com/api/docs/#api_search_videos
"""

from __future__ import annotations

import json
import urllib.parse
from collections.abc import Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Any

API = "https://pixabay.com/api/videos/"
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
