from __future__ import annotations

import os
import time
import uuid
from collections.abc import AsyncIterable, Callable, Iterable, Iterator
from typing import Any, BinaryIO

import httpx

from . import _core, webhooks
from ._core import CHUNK_BYTES, ProgressCallback, backoff, clean, path_id
from .errors import (
    APIError,
    ConnectionError,
    RateLimitError,
    TimeoutError,
    error_from_response,
)
from .types import (
    CreateVideoResponse,
    LabOutcome,
    Rubric,
    RubricInputLike,
    Video,
)

UploadSource = str | os.PathLike[str] | bytes | bytearray | memoryview | BinaryIO | Iterable[bytes]
AsyncUploadSource = UploadSource | AsyncIterable[bytes]


class _Webhooks:
    """Namespace so `client.webhooks.verify_signature(...)` works like in the TypeScript SDK."""

    verify_signature = staticmethod(webhooks.verify_signature)
    construct_event = staticmethod(webhooks.construct_event)


def _retry_delay(error: APIError, attempt: int) -> float:
    if isinstance(error, RateLimitError) and error.retry_after is not None:
        return error.retry_after
    return backoff(attempt)


def _should_retry(status: int, replay_safe: bool) -> bool:
    return status == 429 or (status >= 500 and replay_safe)


def _headers(api_key: str, idempotency_key: str | None) -> dict[str, str]:
    headers = {"Authorization": f"Bearer {api_key}", "Accept": "application/json"}
    if idempotency_key:
        headers["Idempotency-Key"] = idempotency_key
    return headers


# ---------------------------------------------------------------------------- sync


def _sync_chunks(source: Any, total: int, on_progress: ProgressCallback | None) -> Iterator[bytes]:
    sent = 0

    def raw() -> Iterator[bytes]:
        if isinstance(source, str | os.PathLike):
            with open(source, "rb") as f:
                yield from iter(lambda: f.read(CHUNK_BYTES), b"")
        elif isinstance(source, bytes | bytearray | memoryview):
            view = memoryview(source)
            for i in range(0, len(view), CHUNK_BYTES):
                yield bytes(view[i : i + CHUNK_BYTES])
        elif hasattr(source, "read"):
            yield from iter(lambda: source.read(CHUNK_BYTES), b"")
        else:
            yield from source

    for chunk in raw():
        yield chunk
        sent += len(chunk)
        if on_progress:
            on_progress(sent, total)


class _Http:
    def __init__(self, cfg: _core.Config, transport: httpx.BaseTransport | None,
                 sleep: Callable[[float], None]) -> None:
        self.cfg = cfg
        self.sleep = sleep
        self.client = httpx.Client(
            base_url=cfg.base_url, timeout=cfg.timeout, transport=transport
        )

    def request(
        self,
        method: str,
        path: str,
        *,
        params: dict[str, Any] | None = None,
        json: Any = None,
        idempotency_key: str | None = None,
    ) -> Any:
        headers = _headers(self.cfg.api_key, idempotency_key)
        replay_safe = method != "POST" or idempotency_key is not None
        attempt = 0
        while True:
            last = attempt >= self.cfg.max_retries
            try:
                response = self.client.request(
                    method, path, params=clean(params or {}), json=json, headers=headers
                )
            except httpx.HTTPError as exc:
                if last or not replay_safe:
                    raise ConnectionError(f"{method} {path} failed: {exc}") from exc
                self.sleep(backoff(attempt))
                attempt += 1
                continue
            if response.is_success:
                return None if response.status_code == 204 else response.json()
            error = error_from_response(response)
            if last or not _should_retry(response.status_code, replay_safe):
                raise error
            self.sleep(_retry_delay(error, attempt))
            attempt += 1

    def close(self) -> None:
        self.client.close()


class Videos:
    def __init__(self, http: _Http) -> None:
        self._http = http

    def create(
        self,
        *,
        rubric_id: str,
        filename: str,
        content_type: str,
        size_bytes: int,
        rubric_version: int | None = None,
        external_id: str | None = None,
        contributor_ref: str | None = None,
        lab_outcome: LabOutcome | dict[str, Any] | None = None,
        idempotency_key: str | None = None,
    ) -> CreateVideoResponse:
        """Register a video and get a signed upload target. A key is generated when omitted."""
        body = clean(
            {
                "rubric_id": rubric_id,
                "rubric_version": rubric_version,
                "external_id": external_id,
                "contributor_ref": contributor_ref,
                "filename": filename,
                "content_type": content_type,
                "size_bytes": size_bytes,
                "lab_outcome": _dump(lab_outcome),
            }
        )
        data = self._http.request(
            "POST", "/videos", json=body, idempotency_key=idempotency_key or str(uuid.uuid4())
        )
        return CreateVideoResponse.model_validate(data)

    def complete(self, video_id: str) -> Video:
        return Video.model_validate(
            self._http.request("POST", f"/videos/{path_id(video_id)}/complete")
        )

    def get(self, video_id: str) -> Video:
        return Video.model_validate(self._http.request("GET", f"/videos/{path_id(video_id)}"))

    def list_page(
        self,
        *,
        status: str | None = None,
        decision: str | None = None,
        cursor: str | None = None,
        limit: int | None = None,
    ) -> tuple[list[Video], str | None]:
        data = self._http.request(
            "GET",
            "/videos",
            params={"status": status, "decision": decision, "cursor": cursor, "limit": limit},
        )
        return [Video.model_validate(v) for v in data["data"]], data.get("next_cursor")

    def list(
        self,
        *,
        status: str | None = None,
        decision: str | None = None,
        limit: int | None = None,
    ) -> Iterator[Video]:
        """Iterate over every matching video, fetching pages as needed."""
        cursor: str | None = None
        while True:
            videos, cursor = self.list_page(
                status=status, decision=decision, cursor=cursor, limit=limit
            )
            yield from videos
            if not cursor:
                return

    def upload(
        self,
        source: UploadSource,
        *,
        rubric_id: str,
        filename: str | None = None,
        content_type: str | None = None,
        size_bytes: int | None = None,
        rubric_version: int | None = None,
        external_id: str | None = None,
        contributor_ref: str | None = None,
        lab_outcome: LabOutcome | dict[str, Any] | None = None,
        on_progress: ProgressCallback | None = None,
        idempotency_key: str | None = None,
    ) -> Video:
        """Create, upload the bytes to the signed URL and complete, in one call.

        `source` is a path, bytes, a binary file object or an iterable of bytes (then
        `size_bytes` is required). `on_progress(bytes_uploaded, total_bytes)` is called per chunk.
        Uploads are not retried: on failure retry with the same `idempotency_key`.
        """
        name, ctype, size = _core.resolve_upload(
            source, filename=filename, content_type=content_type, size_bytes=size_bytes
        )
        created = self.create(
            rubric_id=rubric_id, filename=name, content_type=ctype, size_bytes=size,
            rubric_version=rubric_version, external_id=external_id,
            contributor_ref=contributor_ref, lab_outcome=lab_outcome,
            idempotency_key=idempotency_key,
        )
        # The signed URL carries its own credentials: never send the API key to it.
        try:
            response = self._http.client.put(
                str(created.upload_url),
                content=_sync_chunks(source, size, on_progress),
                headers={"Content-Type": ctype, "Content-Length": str(size)},
            )
        except httpx.HTTPError as exc:
            raise ConnectionError(f"Upload failed: {exc}") from exc
        if not response.is_success:
            raise APIError(response.status_code, "upload_failed", "Upload to the signed URL failed.")
        return self.complete(created.video.id)

    def wait_for_decision(
        self,
        video_id: str,
        *,
        timeout: float = 600,
        initial_interval: float = 1.0,
        max_interval: float = 15.0,
    ) -> Video:
        """Poll until the video is decided, failed or deleted. Raises `TimeoutError`."""
        deadline = time.monotonic() + timeout
        interval = initial_interval
        while True:
            video = self.get(video_id)
            if video.status.value in _core.TERMINAL_STATUSES:
                return video
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise TimeoutError(
                    f"Video {video_id} was still {video.status.value!r} after the timeout."
                )
            self._http.sleep(min(remaining, interval * (0.5 + _jitter() / 2)))
            interval = min(max_interval, interval * 1.5)


class Review:
    def __init__(self, http: _Http) -> None:
        self._http = http

    def submit(self, video_id: str, *, decision: str, note: str | None = None) -> Video:
        """Record a human reviewer's final decision (`accept` or `reject`)."""
        body = clean({"decision": decision, "note": note})
        return Video.model_validate(
            self._http.request("POST", f"/videos/{path_id(video_id)}/review", json=body)
        )


class LabOutcomes:
    def __init__(self, http: _Http) -> None:
        self._http = http

    def submit(self, video_id: str, *, outcome: str, reason: str | None = None) -> Video:
        """Record what the lab decided, used to measure Quellix's precision."""
        body = clean({"outcome": outcome, "reason": reason})
        return Video.model_validate(
            self._http.request("POST", f"/videos/{path_id(video_id)}/lab-outcome", json=body)
        )


class Rubrics:
    def __init__(self, http: _Http) -> None:
        self._http = http

    def create(self, rubric: RubricInputLike) -> Rubric:
        return Rubric.model_validate(self._http.request("POST", "/rubrics", json=dict(rubric)))

    def get(self, rubric_id: str, *, version: int | None = None) -> Rubric:
        data = self._http.request(
            "GET", f"/rubrics/{path_id(rubric_id)}", params={"version": version}
        )
        return Rubric.model_validate(data)

    def list(self) -> list[Rubric]:
        data = self._http.request("GET", "/rubrics")
        return [Rubric.model_validate(r) for r in data["data"]]

    def new_version(self, rubric_id: str, rubric: RubricInputLike) -> Rubric:
        data = self._http.request("PUT", f"/rubrics/{path_id(rubric_id)}", json=dict(rubric))
        return Rubric.model_validate(data)


class Quellix:
    """Synchronous client. Reads QUELLIX_API_KEY and QUELLIX_BASE_URL when not passed."""

    def __init__(
        self,
        api_key: str | None = None,
        *,
        base_url: str | None = None,
        max_retries: int = 2,
        timeout: float = 30.0,
        transport: httpx.BaseTransport | None = None,
        sleep: Callable[[float], None] = time.sleep,
    ) -> None:
        cfg = _core.resolve_config(api_key, base_url, max_retries, timeout)
        self._http = _Http(cfg, transport, sleep)
        self.videos = Videos(self._http)
        self.review = Review(self._http)
        self.lab_outcome = LabOutcomes(self._http)
        self.rubrics = Rubrics(self._http)
        self.webhooks = _Webhooks()

    def close(self) -> None:
        self._http.close()

    def __enter__(self) -> Quellix:
        return self

    def __exit__(self, *exc: object) -> None:
        self.close()


def _jitter() -> float:
    import random

    return random.random()


def _dump(value: LabOutcome | dict[str, Any] | None) -> dict[str, Any] | None:
    if value is None or isinstance(value, dict):
        return value
    return value.model_dump(mode="json", exclude_none=True)
