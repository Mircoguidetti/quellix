"""HoloAssist (CDLA-Permissive-2.0): single recordings out of the 184 GB video tar, over HTTP.

The project page (https://holoassist.github.io/) publishes one tar per modality:

    https://hl2data.z5.web.core.windows.net/holoassist-data-release/video_pitch_shifted.tar
    https://hl2data.z5.web.core.windows.net/holoassist-data-release/data-annotation-trainval-v1_1.json

We never download the tar. A tar is a sequence of 512-byte headers, each followed by the file's
data, so a few thousand small range requests list its members (name, offset, size), and a single
range request then fetches one recording. Nothing here talks to the network except `UrllibHttp`;
the rest takes an `Http` object, so the tests run on an in-memory tar.
"""

from __future__ import annotations

import json
import tarfile
import time
import urllib.error
import urllib.request
from collections import defaultdict
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Protocol

RELEASE = "https://hl2data.z5.web.core.windows.net/holoassist-data-release"
VIDEO_TAR = f"{RELEASE}/video_pitch_shifted.tar"
ANNOTATIONS = f"{RELEASE}/data-annotation-trainval-v1_1.json"
LICENSE = "CDLA-Permissive-2.0"
DATASET = "HoloAssist"
BLOCK = 512


class Http(Protocol):
    def size(self, url: str) -> int: ...

    def read(self, url: str, start: int, length: int) -> bytes: ...

    def download(self, url: str, start: int, length: int, dst: Path) -> None: ...


class UrllibHttp:  # pragma: no cover - network
    """Range requests with the standard library, a few retries each."""

    def __init__(self, retries: int = 4, timeout: float = 60.0) -> None:
        self.retries, self.timeout = retries, timeout

    def _open(self, url: str, start: int | None = None, length: int | None = None, method="GET"):
        headers = {"User-Agent": "ormes-eval/0.1"}
        if start is not None and length is not None:
            headers["Range"] = f"bytes={start}-{start + length - 1}"
        last: Exception | None = None
        for attempt in range(self.retries):
            try:
                req = urllib.request.Request(url, headers=headers, method=method)
                return urllib.request.urlopen(req, timeout=self.timeout)  # noqa: S310
            except (urllib.error.URLError, TimeoutError, ConnectionError) as e:
                last = e
                time.sleep(1.5 * (attempt + 1))
        raise RuntimeError(f"{method} {url} failed after {self.retries} tries: {last}")

    def size(self, url: str) -> int:
        with self._open(url, method="HEAD") as r:
            return int(r.headers["Content-Length"])

    def read(self, url: str, start: int, length: int) -> bytes:
        with self._open(url, start, length) as r:
            return r.read()

    def download(self, url: str, start: int, length: int, dst: Path) -> None:
        dst.parent.mkdir(parents=True, exist_ok=True)
        with self._open(url, start, length) as r, open(dst, "wb") as f:
            while chunk := r.read(1 << 20):
                f.write(chunk)


@dataclass(frozen=True)
class TarEntry:
    name: str
    offset: int       # where the file's data starts
    size: int

    @property
    def recording(self) -> str:
        return self.name.split("/", 1)[0]

    @property
    def task(self) -> str:
        return task_of(self.recording)


def task_of(recording: str) -> str:
    """'R007-7July-DSLR' -> 'DSLR'."""
    return recording.rsplit("-", 1)[-1] if "-" in recording else recording


def _pax_path(payload: bytes) -> str | None:
    for record in payload.split(b"\n"):
        _, _, kv = record.partition(b" ")
        if kv.startswith(b"path="):
            return kv[5:].decode("utf-8", "surrogateescape")
    return None


def list_tar(
    http: Http, url: str, max_entries: int = 600, max_seconds: float = 180.0,
    clock: Callable[[], float] = time.monotonic,
) -> list[TarEntry]:
    """The first `max_entries` regular files of a remote tar, from their headers only."""
    total = http.size(url)
    started = clock()
    pos, pending, entries = 0, None, []
    while pos + BLOCK <= total and len(entries) < max_entries and clock() - started < max_seconds:
        block = http.read(url, pos, BLOCK)
        if len(block) < BLOCK or not block.strip(b"\0"):
            break
        info = tarfile.TarInfo.frombuf(block, "utf-8", "surrogateescape")
        data = pos + BLOCK
        padded = -(-info.size // BLOCK) * BLOCK
        if info.type == tarfile.GNUTYPE_LONGNAME:
            pending = http.read(url, data, info.size).rstrip(b"\0").decode("utf-8", "replace")
        elif info.type in (tarfile.XHDTYPE, tarfile.XGLTYPE):
            path = _pax_path(http.read(url, data, info.size))
            if info.type == tarfile.XHDTYPE and path:
                pending = path
        else:
            name, pending = pending or info.name, None
            if info.isfile():
                entries.append(TarEntry(name, data, info.size))
        pos = data + padded
    return entries


def video_entries(entries: Sequence[TarEntry]) -> list[TarEntry]:
    return [e for e in entries if e.name.lower().endswith(".mp4")]


def pick_recordings(
    entries: Sequence[TarEntry], n: int, max_bytes: int = 400_000_000
) -> list[TarEntry]:
    """`n` recordings spread over the tasks: round-robin across tasks, evenly within each."""
    by_task: dict[str, list[TarEntry]] = defaultdict(list)
    for e in sorted(video_entries(entries), key=lambda e: e.name):
        if e.size <= max_bytes:
            by_task[e.task].append(e)
    queues = {t: list(v) for t, v in sorted(by_task.items(), key=lambda kv: -len(kv[1]))}
    picks: list[TarEntry] = []
    take = 0
    while len(picks) < n and any(queues.values()):
        for items in queues.values():
            if items and len(picks) < n:
                # evenly spaced through this task's recordings, a different one each round
                idx = (take * max(1, len(items) // 3)) % len(items)
                picks.append(items.pop(idx))
        take += 1
    return picks


# --- annotations -------------------------------------------------------------------------


def load_annotations(http: Http, url: str = ANNOTATIONS, dst: Path | None = None) -> list[Any]:
    """The label JSON (a list of sessions), or raises with the exact download error."""
    import tempfile

    target = dst or Path(tempfile.mkdtemp()) / "annotations.json"
    http.download(url, 0, http.size(url), target)
    return json.loads(target.read_text())


def session_for(annotations: Sequence[dict[str, Any]], recording: str) -> dict[str, Any] | None:
    for s in annotations:
        name = str(s.get("video_name", "")).split("/", 1)[0]
        if name == recording:
            return s
    return None


def action_steps(session: dict[str, Any] | None) -> list[dict[str, Any]]:
    """HoloAssist's human-annotated fine-grained actions as [{name, start, end}]."""
    if not session:
        return []
    out = []
    for e in session.get("events", []):
        if e.get("label") != "Fine grained action" or not e.get("end", 0) > e.get("start", 0):
            continue
        attrs = e.get("attributes", {}) or {}
        name = " ".join(str(attrs[k]) for k in ("Verb", "Direct Object") if attrs.get(k))
        out.append({"name": name or "action", "start": float(e["start"]), "end": float(e["end"])})
    return sorted(out, key=lambda s: s["start"])


def steps_in_window(
    steps: Sequence[dict[str, Any]], start_s: float, end_s: float
) -> list[dict[str, Any]]:
    """Annotated actions overlapping [start_s, end_s] of the recording, on the clip's own clock."""
    out = []
    for s in steps:
        if s["end"] <= start_s or s["start"] >= end_s:
            continue
        out.append({
            "name": s["name"],
            "t_s": round(max(s["start"], start_s) - start_s, 2),
            "end_s": round(min(s["end"], end_s) - start_s, 2),
            "source": "HoloAssist annotation",
        })
    return out
