from __future__ import annotations

import asyncio
import os
import time
import uuid
from collections.abc import AsyncIterator, Awaitable, Callable
from typing import Any

import httpx

from . import _core
from ._client import (
    AsyncUploadSource,
    _dump,
    _headers,
    _jitter,
    _retry_delay,
    _should_retry,
    _Webhooks,
)
from ._core import CHUNK_BYTES, ProgressCallback, backoff, clean, path_id
from .errors import APIError, ConnectionError, TimeoutError, error_from_response
from .types import CreateVideoResponse, LabOutcome, Rubric, RubricInputLike, Video


async def _async_chunks(
    source: Any, total: int, on_progress: ProgressCallback | None
) -> AsyncIterator[bytes]:
    sent = 0

    async def raw() -> AsyncIterator[bytes]:
        if isinstance(source, str | os.PathLike):
            f = await asyncio.to_thread(open, source, "rb")
            try:
                while chunk := await asyncio.to_thread(f.read, CHUNK_BYTES):
                    yield chunk
            finally:
                f.close()
        elif isinstance(source, bytes | bytearray | memoryview):
            view = memoryview(source)
            for i in range(0, len(view), CHUNK_BYTES):
                yield bytes(view[i : i + CHUNK_BYTES])
        elif hasattr(source, "__aiter__"):
            async for chunk in source:
                yield chunk
        elif hasattr(source, "read"):
            while chunk := await asyncio.to_thread(source.read, CHUNK_BYTES):
                yield chunk
        else:
            for chunk in source:
                yield chunk

    async for chunk in raw():
        yield chunk
        sent += len(chunk)
        if on_progress:
            on_progress(sent, total)


class _AsyncHttp:
    def __init__(self, cfg: _core.Config, transport: httpx.AsyncBaseTransport | None,
                 sleep: Callable[[float], Awaitable[None]]) -> None:
        self.cfg = cfg
        self.sleep = sleep
        self.client = httpx.AsyncClient(
            base_url=cfg.base_url, timeout=cfg.timeout, transport=transport
        )

    async def request(
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
                response = await self.client.request(
                    method, path, params=clean(params or {}), json=json, headers=headers
                )
            except httpx.HTTPError as exc:
                if last or not replay_safe:
                    raise ConnectionError(f"{method} {path} failed: {exc}") from exc
                await self.sleep(backoff(attempt))
                attempt += 1
                continue
            if response.is_success:
                return None if response.status_code == 204 else response.json()
            error = error_from_response(response)
            if last or not _should_retry(response.status_code, replay_safe):
                raise error
            await self.sleep(_retry_delay(error, attempt))
            attempt += 1

    async def close(self) -> None:
        await self.client.aclose()


class AsyncVideos:
    def __init__(self, http: _AsyncHttp) -> None:
        self._http = http

    async def create(
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
        data = await self._http.request(
            "POST", "/videos", json=body, idempotency_key=idempotency_key or str(uuid.uuid4())
        )
        return CreateVideoResponse.model_validate(data)

    async def complete(self, video_id: str) -> Video:
        data = await self._http.request("POST", f"/videos/{path_id(video_id)}/complete")
        return Video.model_validate(data)

    async def get(self, video_id: str) -> Video:
        return Video.model_validate(await self._http.request("GET", f"/videos/{path_id(video_id)}"))

    async def list_page(
        self,
        *,
        status: str | None = None,
        decision: str | None = None,
        cursor: str | None = None,
        limit: int | None = None,
    ) -> tuple[list[Video], str | None]:
        data = await self._http.request(
            "GET",
            "/videos",
            params={"status": status, "decision": decision, "cursor": cursor, "limit": limit},
        )
        return [Video.model_validate(v) for v in data["data"]], data.get("next_cursor")

    async def list(
        self,
        *,
        status: str | None = None,
        decision: str | None = None,
        limit: int | None = None,
    ) -> AsyncIterator[Video]:
        """Iterate over every matching video: `async for video in client.videos.list()`."""
        cursor: str | None = None
        while True:
            videos, cursor = await self.list_page(
                status=status, decision=decision, cursor=cursor, limit=limit
            )
            for video in videos:
                yield video
            if not cursor:
                return

    async def upload(
        self,
        source: AsyncUploadSource,
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
        """Async version of `Videos.upload`; `source` may also be an async iterable of bytes."""
        name, ctype, size = _core.resolve_upload(
            source, filename=filename, content_type=content_type, size_bytes=size_bytes
        )
        created = await self.create(
            rubric_id=rubric_id, filename=name, content_type=ctype, size_bytes=size,
            rubric_version=rubric_version, external_id=external_id,
            contributor_ref=contributor_ref, lab_outcome=lab_outcome,
            idempotency_key=idempotency_key,
        )
        try:
            response = await self._http.client.put(
                str(created.upload_url),
                content=_async_chunks(source, size, on_progress),
                headers={"Content-Type": ctype, "Content-Length": str(size)},
            )
        except httpx.HTTPError as exc:
            raise ConnectionError(f"Upload failed: {exc}") from exc
        if not response.is_success:
            raise APIError(response.status_code, "upload_failed", "Upload to the signed URL failed.")
        return await self.complete(created.video.id)

    async def wait_for_decision(
        self,
        video_id: str,
        *,
        timeout: float = 600,
        initial_interval: float = 1.0,
        max_interval: float = 15.0,
    ) -> Video:
        deadline = time.monotonic() + timeout
        interval = initial_interval
        while True:
            video = await self.get(video_id)
            if video.status.value in _core.TERMINAL_STATUSES:
                return video
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise TimeoutError(
                    f"Video {video_id} was still {video.status.value!r} after the timeout."
                )
            await self._http.sleep(min(remaining, interval * (0.5 + _jitter() / 2)))
            interval = min(max_interval, interval * 1.5)


class AsyncReview:
    def __init__(self, http: _AsyncHttp) -> None:
        self._http = http

    async def submit(self, video_id: str, *, decision: str, note: str | None = None) -> Video:
        body = clean({"decision": decision, "note": note})
        data = await self._http.request("POST", f"/videos/{path_id(video_id)}/review", json=body)
        return Video.model_validate(data)


class AsyncLabOutcomes:
    def __init__(self, http: _AsyncHttp) -> None:
        self._http = http

    async def submit(self, video_id: str, *, outcome: str, reason: str | None = None) -> Video:
        body = clean({"outcome": outcome, "reason": reason})
        data = await self._http.request(
            "POST", f"/videos/{path_id(video_id)}/lab-outcome", json=body
        )
        return Video.model_validate(data)


class AsyncRubrics:
    def __init__(self, http: _AsyncHttp) -> None:
        self._http = http

    async def create(self, rubric: RubricInputLike) -> Rubric:
        return Rubric.model_validate(await self._http.request("POST", "/rubrics", json=dict(rubric)))

    async def get(self, rubric_id: str, *, version: int | None = None) -> Rubric:
        data = await self._http.request(
            "GET", f"/rubrics/{path_id(rubric_id)}", params={"version": version}
        )
        return Rubric.model_validate(data)

    async def list(self) -> list[Rubric]:
        data = await self._http.request("GET", "/rubrics")
        return [Rubric.model_validate(r) for r in data["data"]]

    async def new_version(self, rubric_id: str, rubric: RubricInputLike) -> Rubric:
        data = await self._http.request("PUT", f"/rubrics/{path_id(rubric_id)}", json=dict(rubric))
        return Rubric.model_validate(data)


class AsyncOrmes:
    """Asynchronous client. Reads ORMES_API_KEY and ORMES_BASE_URL when not passed."""

    def __init__(
        self,
        api_key: str | None = None,
        *,
        base_url: str | None = None,
        max_retries: int = 2,
        timeout: float = 30.0,
        transport: httpx.AsyncBaseTransport | None = None,
        sleep: Callable[[float], Awaitable[None]] = asyncio.sleep,
    ) -> None:
        cfg = _core.resolve_config(api_key, base_url, max_retries, timeout)
        self._http = _AsyncHttp(cfg, transport, sleep)
        self.videos = AsyncVideos(self._http)
        self.review = AsyncReview(self._http)
        self.lab_outcome = AsyncLabOutcomes(self._http)
        self.rubrics = AsyncRubrics(self._http)
        self.webhooks = _Webhooks()

    async def aclose(self) -> None:
        await self._http.close()

    async def __aenter__(self) -> AsyncOrmes:
        return self

    async def __aexit__(self, *exc: object) -> None:
        await self.aclose()
