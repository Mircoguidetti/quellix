from __future__ import annotations

from collections.abc import AsyncIterator
from pathlib import Path

import pytest

from quellix import AsyncQuellix, NotFoundError, RateLimitError, TimeoutError

from .mock_api import API_KEY, BASE, MockApi


def make(api: MockApi, sleeps: list[float] | None = None, **kwargs: int) -> AsyncQuellix:
    record = sleeps if sleeps is not None else []

    async def sleep(seconds: float) -> None:
        record.append(seconds)

    return AsyncQuellix(
        API_KEY, base_url=BASE, transport=api.async_transport(), sleep=sleep, **kwargs
    )


async def test_upload_wait_review_and_list(api: MockApi, tmp_path: Path) -> None:
    path = tmp_path / "a.mp4"
    path.write_bytes(b"z" * (2 * 1024 * 1024))
    progress: list[int] = []
    async with make(api) as client:
        video = await client.videos.upload(
            path, rubric_id="r", on_progress=lambda done, total: progress.append(done)
        )
        assert len(api.uploads[video.id]) == 2 * 1024 * 1024
        assert progress[-1] == 2 * 1024 * 1024
        api.decide_after_gets = 2
        decided = await client.videos.wait_for_decision(video.id)
        assert decided.status.value == "decided"
        reviewed = await client.review.submit(video.id, decision="accept")
        assert reviewed.review is not None
        labbed = await client.lab_outcome.submit(video.id, outcome="reject", reason="blurry")
        assert labbed.lab_outcome is not None
        assert [v.id async for v in client.videos.list(limit=1)] == [video.id]


async def test_upload_async_iterable_and_bytes(api: MockApi) -> None:
    async def chunks() -> AsyncIterator[bytes]:
        yield b"a" * 5
        yield b"b" * 5

    async with make(api) as client:
        video = await client.videos.upload(chunks(), rubric_id="r", filename="a.mp4", size_bytes=10)
        assert api.uploads[video.id] == b"a" * 5 + b"b" * 5
        v2 = await client.videos.upload(b"1234", rubric_id="r", filename="b.webm")
        assert api.uploads[v2.id] == b"1234"


async def test_errors_and_retries(api: MockApi) -> None:
    sleeps: list[float] = []
    async with make(api, sleeps) as client:
        with pytest.raises(NotFoundError):
            await client.videos.get("missing")
        api.fail_next(1, 429, {"Retry-After": "2"})
        with pytest.raises(NotFoundError):
            await client.videos.get("missing")
        assert sleeps == [2.0]
    api.fail_next(5, 429, {"Retry-After": "9"})
    async with make(api, max_retries=0) as client:
        with pytest.raises(RateLimitError) as info:
            await client.videos.get("x")
        assert info.value.retry_after == 9.0


async def test_wait_times_out(api: MockApi) -> None:
    async with make(api) as client:
        video = await client.videos.upload(b"1234", rubric_id="r", filename="a.mp4")
        api.decide_after_gets = 10**6
        with pytest.raises(TimeoutError):
            await client.videos.wait_for_decision(video.id, timeout=0)


async def test_rubrics(api: MockApi) -> None:
    import json

    rubric = json.loads(
        (Path(__file__).parents[2] / "contracts/examples/rubric.load_dishwasher.json").read_text()
    )
    body = {k: v for k, v in rubric.items() if k not in {"id", "version"}}
    async with make(api) as client:
        created = await client.rubrics.create(body)
        assert (await client.rubrics.new_version(created.id, body)).version == 2
        assert (await client.rubrics.get(created.id, version=1)).version == 1
        assert len(await client.rubrics.list()) == 1
