from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest

from ormes import (
    APIError,
    AuthenticationError,
    NotFoundError,
    Ormes,
    RateLimitError,
    TimeoutError,
    ValidationError,
)

from .mock_api import API_KEY, BASE, MockApi

RUBRIC = json.loads(
    (Path(__file__).parents[2] / "contracts" / "examples" / "rubric.load_dishwasher.json").read_text()
)
RUBRIC_INPUT = {k: v for k, v in RUBRIC.items() if k not in {"id", "version"}}


def make(api: MockApi, sleeps: list[float] | None = None, **kwargs: Any) -> Ormes:
    record = sleeps if sleeps is not None else []
    return Ormes(
        kwargs.pop("api_key", API_KEY),
        base_url=BASE,
        transport=api.sync_transport(),
        sleep=record.append,
        **kwargs,
    )


def test_create_sends_idempotency_key(api: MockApi) -> None:
    res = make(api).videos.create(
        rubric_id="rub_x", filename="a.mp4", content_type="video/mp4", size_bytes=10
    )
    assert res.video.status.value == "awaiting_upload"
    request = api.calls("createVideo")[0]
    assert len(request.headers["idempotency-key"]) == 36
    assert request.headers["authorization"] == f"Bearer {API_KEY}"


def test_upload_bytes_with_progress(api: MockApi) -> None:
    data = b"x" * (3 * 1024 * 1024 + 5)
    seen: list[int] = []
    video = make(api).videos.upload(
        data, rubric_id="rub_x", filename="a.mp4", on_progress=lambda done, total: seen.append(done)
    )
    assert video.status.value == "queued"
    assert len(api.uploads[video.id]) == len(data)
    assert seen[-1] == len(data) and len(seen) > 1
    put = api.calls("__upload")[0]
    assert "authorization" not in put.headers
    assert put.headers["content-type"] == "video/mp4"


def test_upload_path_and_file_object_and_stream(api: MockApi, tmp_path: Path) -> None:
    path = tmp_path / "kitchen.mov"
    path.write_bytes(b"1" * 2048)
    client = make(api)
    v1 = client.videos.upload(path, rubric_id="rub_x")
    assert len(api.uploads[v1.id]) == 2048
    create = api.requests[0][2]
    assert create["filename"] == "kitchen.mov" and create["content_type"] == "video/quicktime"
    with path.open("rb") as handle:
        v2 = client.videos.upload(handle, rubric_id="rub_x")
    assert len(api.uploads[v2.id]) == 2048
    v3 = client.videos.upload(
        iter([b"a" * 10, b"b" * 10]), rubric_id="rub_x", filename="s.webm", size_bytes=20
    )
    assert api.uploads[v3.id] == b"a" * 10 + b"b" * 10
    with pytest.raises(Exception, match="size_bytes"):
        client.videos.upload(iter([b"a"]), rubric_id="rub_x", filename="s.webm")


def test_list_auto_paginates(api: MockApi) -> None:
    client = make(api)
    for _ in range(5):
        client.videos.create(rubric_id="r", filename="a.mp4", content_type="video/mp4", size_bytes=1)
    api.requests.clear()
    ids = [v.id for v in client.videos.list(limit=2)]
    assert len(ids) == 5 and len(set(ids)) == 5
    assert len(api.calls("listVideos")) == 3


def test_wait_for_decision(api: MockApi) -> None:
    sleeps: list[float] = []
    client = make(api, sleeps)
    video = client.videos.upload(b"1234", rubric_id="r", filename="a.mp4")
    api.decide_after_gets = 2
    decided = client.videos.wait_for_decision(video.id)
    assert decided.status.value == "decided"
    assert decided.decision is not None and decided.decision.decision.value == "accept"
    assert len(sleeps) == 2 and sleeps[1] > sleeps[0] * 0.5


def test_wait_for_decision_times_out(api: MockApi) -> None:
    client = make(api)
    video = client.videos.upload(b"1234", rubric_id="r", filename="a.mp4")
    api.decide_after_gets = 10**6
    with pytest.raises(TimeoutError):
        client.videos.wait_for_decision(video.id, timeout=0)


def test_review_and_lab_outcome(api: MockApi) -> None:
    client = make(api)
    video = client.videos.upload(b"1234", rubric_id="r", filename="a.mp4")
    reviewed = client.review.submit(video.id, decision="reject", note="blurry")
    assert reviewed.review is not None and reviewed.review.note == "blurry"
    labbed = client.lab_outcome.submit(video.id, outcome="accept")
    assert labbed.lab_outcome is not None and labbed.lab_outcome.outcome.value == "accept"


def test_rubrics(api: MockApi) -> None:
    client = make(api)
    created = client.rubrics.create(RUBRIC_INPUT)
    assert created.version == 1
    second = client.rubrics.new_version(created.id, {**RUBRIC_INPUT, "name": "v2"})
    assert second.version == 2
    assert client.rubrics.get(created.id).version == 2
    assert client.rubrics.get(created.id, version=1).name == RUBRIC["name"]
    assert [r.id for r in client.rubrics.list()] == [created.id]


def test_typed_errors(api: MockApi) -> None:
    with pytest.raises(AuthenticationError):
        make(api, api_key="wrong").videos.get("x")
    with pytest.raises(NotFoundError):
        make(api).videos.get("missing")
    with pytest.raises(ValidationError) as info:
        make(api).videos.create(rubric_id="r", filename="a.mp4", content_type="video/mp4", size_bytes=0)
    assert info.value.fields


def test_retries_honor_retry_after(api: MockApi) -> None:
    sleeps: list[float] = []
    client = make(api, sleeps)
    api.fail_next(1, 503)
    with pytest.raises(NotFoundError):
        client.videos.get("missing")
    assert len(api.calls("getVideo")) == 2
    api.requests.clear()
    sleeps.clear()
    api.fail_next(1, 429, {"Retry-After": "3"})
    with pytest.raises(NotFoundError):
        client.videos.get("missing")
    assert sleeps == [3.0]


def test_rate_limit_error_after_retries(api: MockApi) -> None:
    api.fail_next(5, 429, {"Retry-After": "7"})
    with pytest.raises(RateLimitError) as info:
        make(api, max_retries=1).videos.get("x")
    assert info.value.retry_after == 7.0


def test_create_retried_with_same_key_but_complete_is_not(api: MockApi) -> None:
    client = make(api)
    api.fail_next(1, 500)
    client.videos.create(rubric_id="r", filename="a.mp4", content_type="video/mp4", size_bytes=1)
    keys = [r.headers["idempotency-key"] for r in api.calls("createVideo")]
    assert len(keys) == 2 and keys[0] == keys[1]
    api.requests.clear()
    api.fail_next(1, 500)
    with pytest.raises(APIError):
        client.videos.complete("vid_1")
    assert len(api.calls("completeUpload")) == 1


def test_environment_configuration(api: MockApi, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("ORMES_API_KEY", raising=False)
    with pytest.raises(Exception, match="API key"):
        Ormes(transport=api.sync_transport())
    monkeypatch.setenv("ORMES_API_KEY", API_KEY)
    monkeypatch.setenv("ORMES_BASE_URL", BASE)
    with pytest.raises(NotFoundError), Ormes(transport=api.sync_transport()) as client:
        client.videos.get("missing")


def test_legacy_quellix_environment_names_still_work(
    api: MockApi, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.delenv("ORMES_API_KEY", raising=False)
    monkeypatch.delenv("ORMES_BASE_URL", raising=False)
    monkeypatch.setenv("QUELLIX_API_KEY", API_KEY)
    monkeypatch.setenv("QUELLIX_BASE_URL", BASE)
    with pytest.raises(NotFoundError), Ormes(transport=api.sync_transport()) as client:
        client.videos.get("missing")
    # The new names win when both are set.
    monkeypatch.setenv("ORMES_API_KEY", "orm_live_other")
    with pytest.raises(Exception, match="401|nauthor|uthentic"), Ormes(
        transport=api.sync_transport()
    ) as client:
        client.videos.get("missing")
