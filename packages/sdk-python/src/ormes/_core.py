"""Pieces shared by the sync and async clients."""

from __future__ import annotations

import os
import random
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from typing import Any
from urllib.parse import quote

from .errors import OrmesError

DEFAULT_BASE_URL = "https://quellix-orpin.vercel.app/api/v1"
CHUNK_BYTES = 1 << 20

CONTENT_TYPES = {"mp4": "video/mp4", "mov": "video/quicktime", "webm": "video/webm"}
TERMINAL_STATUSES = {"decided", "failed", "deleted"}


@dataclass
class Config:
    api_key: str
    base_url: str
    max_retries: int
    timeout: float


def _env(name: str, legacy: str) -> str | None:
    """The new variable name first; the pre-rename `QUELLIX_*` name still works."""
    return os.environ.get(name) or os.environ.get(legacy) or None


def resolve_config(
    api_key: str | None, base_url: str | None, max_retries: int, timeout: float
) -> Config:
    key = api_key or _env("ORMES_API_KEY", "QUELLIX_API_KEY")
    if not key:
        raise OrmesError("Missing API key: pass `api_key` or set ORMES_API_KEY.")
    url = base_url or _env("ORMES_BASE_URL", "QUELLIX_BASE_URL") or DEFAULT_BASE_URL
    return Config(key, url.rstrip("/"), max_retries, timeout)


def backoff(attempt: int) -> float:
    """Exponential backoff with full jitter: random in [0, min(8s, 0.5s * 2**attempt)]."""
    return random.uniform(0, min(8.0, 0.5 * 2**attempt))


def path_id(value: str) -> str:
    return quote(value, safe="")


def clean(values: Mapping[str, Any]) -> dict[str, Any]:
    """Drop None values so optional arguments are not sent."""
    return {k: v for k, v in values.items() if v is not None}


def content_type_for(filename: str | None) -> str | None:
    if not filename or "." not in filename:
        return None
    return CONTENT_TYPES.get(filename.rsplit(".", 1)[1].lower())


@dataclass
class SourceInfo:
    size: int | None
    filename: str | None


def inspect_source(source: Any) -> SourceInfo:
    if isinstance(source, str | os.PathLike):
        path = os.fspath(source)
        return SourceInfo(os.stat(path).st_size, os.path.basename(str(path)))
    if isinstance(source, bytes | bytearray | memoryview):
        return SourceInfo(len(source), None)
    name = getattr(source, "name", None)
    filename = os.path.basename(name) if isinstance(name, str) else None
    size: int | None = None
    if hasattr(source, "seek") and hasattr(source, "tell"):
        try:
            here = source.tell()
            size = source.seek(0, os.SEEK_END) - here
            source.seek(here)
        except (OSError, ValueError):
            size = None
    return SourceInfo(size, filename)


def resolve_upload(
    source: Any,
    *,
    filename: str | None,
    content_type: str | None,
    size_bytes: int | None,
) -> tuple[str, str, int]:
    info = inspect_source(source)
    size = size_bytes if size_bytes is not None else info.size
    name = filename or info.filename
    ctype = content_type or content_type_for(name)
    if size is None:
        raise OrmesError("`size_bytes` is required when uploading a stream.")
    if not name:
        raise OrmesError("`filename` is required when it cannot be inferred from the source.")
    if not ctype:
        raise OrmesError(
            "`content_type` is required: use video/mp4, video/quicktime or video/webm."
        )
    return name, ctype, size


ProgressCallback = Callable[[int, int], None]
