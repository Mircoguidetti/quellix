"""Read single members of a huge remote tar with HTTP Range requests.

HoloAssist ships its data as a few very large tars (the compressed videos alone are ~145 GB).
A benchmark needs a few sessions, so instead of downloading a tar we walk its 512-byte headers
with Range requests (one small request per member), keep a name -> (offset, size) index, and
fetch only the members we need. Handles ustar, GNU long names ('L') and pax headers ('x').
"""

from __future__ import annotations

import json
import re
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path

import httpx

BLOCK = 512


def _blocks(n: int) -> int:
    return (n + BLOCK - 1) // BLOCK * BLOCK


@dataclass(frozen=True)
class Member:
    name: str
    offset: int     # where the member's data starts
    size: int


def _cstr(b: bytes) -> str:
    return b.split(b"\0", 1)[0].decode("utf-8", "replace")


def _octal(b: bytes) -> int:
    if b and b[0] & 0x80:                      # GNU base-256 for sizes over 8 GB
        return int.from_bytes(b[1:], "big")
    s = b.split(b"\0", 1)[0].strip()
    return int(s, 8) if s else 0


def _pax_path(data: bytes) -> str | None:
    for m in re.finditer(rb"(\d+) path=([^\n]*)\n", data):
        return m.group(2).decode("utf-8", "replace")
    return None


class RangeReader:
    """GET byte ranges of one URL, reusing the connection."""

    def __init__(self, url: str, client: httpx.Client | None = None, retries: int = 3) -> None:
        self.url = url
        self._client = client or httpx.Client(timeout=120, follow_redirects=True)
        self._retries = retries

    def read(self, start: int, length: int) -> bytes:
        headers = {"Range": f"bytes={start}-{start + length - 1}"}
        for attempt in range(self._retries + 1):
            try:
                r = self._client.get(self.url, headers=headers)
                if r.status_code == 416:       # past the end
                    return b""
                r.raise_for_status()
                if r.status_code != 206 and start:
                    raise RuntimeError(f"server ignored the Range header ({r.status_code})")
                return r.content[:length]
            except (httpx.HTTPError, RuntimeError):
                if attempt == self._retries:
                    raise
        raise AssertionError("unreachable")

    def copy_to(self, start: int, length: int, dst: Path, chunk: int = 1 << 24) -> None:
        dst.parent.mkdir(parents=True, exist_ok=True)
        with dst.open("wb") as f:
            done = 0
            while done < length:
                n = min(chunk, length - done)
                data = self.read(start + done, n)
                if not data:
                    raise RuntimeError(f"short read at {start + done} of {self.url}")
                f.write(data)
                done += len(data)


def walk(reader: RangeReader, keep: Callable[[str], bool] = lambda name: True,
         limit: int | None = None) -> dict[str, Member]:
    """Index the tar's regular files (only those `keep` accepts). One request per member."""
    index: dict[str, Member] = {}
    pos = 0
    long_name: str | None = None
    seen = 0
    while limit is None or seen < limit:
        header = reader.read(pos, BLOCK)
        if len(header) < BLOCK or header == b"\0" * BLOCK:
            break
        size = _octal(header[124:136])
        typeflag = header[156:157]
        data_at = pos + BLOCK
        if typeflag in (b"L", b"x", b"g"):
            meta = reader.read(data_at, size)
            if typeflag == b"L":
                long_name = _cstr(meta)
            elif typeflag == b"x":
                long_name = _pax_path(meta) or long_name
        else:
            name = long_name or _cstr(header[0:100])
            prefix = _cstr(header[345:500]) if header[257:262] == b"ustar" else ""
            if prefix and long_name is None:
                name = f"{prefix}/{name}"
            long_name = None
            if typeflag in (b"0", b"\0", b"7") and keep(name):
                index[name] = Member(name, data_at, size)
            seen += 1
        pos = data_at + _blocks(size)
    return index


def load_or_walk(reader: RangeReader, cache: Path,
                 keep: Callable[[str], bool] = lambda name: True) -> dict[str, Member]:
    if cache.exists():
        raw = json.loads(cache.read_text())
        if raw.get("url") == reader.url:
            return {k: Member(k, *v) for k, v in raw["members"].items()}
    index = walk(reader, keep)
    cache.parent.mkdir(parents=True, exist_ok=True)
    cache.write_text(json.dumps({"url": reader.url,
                                 "members": {k: [m.offset, m.size] for k, m in index.items()}}))
    return index
