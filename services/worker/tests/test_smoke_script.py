import importlib.util
import json
from pathlib import Path

import httpx
import pytest

spec = importlib.util.spec_from_file_location(
    "smoke_test", Path(__file__).parents[1] / "scripts" / "smoke_test.py")
smoke = importlib.util.module_from_spec(spec)
spec.loader.exec_module(smoke)


kept = {"review": False}


def fake_supabase(decision_after: int):
    """Returns (handler, log). The decision appears after `decision_after` polls."""
    log: list[httpx.Request] = []
    state = {"polls": 0}

    def handler(req: httpx.Request) -> httpx.Response:
        log.append(req)
        p, m = req.url.path, req.method
        if p.endswith("/organizations") and m == "GET":
            return httpx.Response(200, json=[])
        if p.endswith("/organizations"):
            return httpx.Response(201, json=[{"id": "org1"}])
        if p.endswith("/rubrics") and m == "POST":
            return httpx.Response(201, json=[{"id": "rub1"}])
        if p.endswith("/jobs"):
            return httpx.Response(201, json=[{"id": "job1"}])
        if p.endswith("/decisions"):
            state["polls"] += 1
            if state["polls"] <= decision_after:
                return httpx.Response(200, json=[])
            return httpx.Response(200, json=[{
                "video_id": req.url.params["video_id"].removeprefix("eq."),
                "decision": "review" if kept["review"] else "accept", "reasons": [],
                "checks": {}, "rubric_id": "rub1",
                "rubric_version": 1, "engine_version": "0.1.0"}])
        if p.endswith("/videos") and m == "GET":
            if kept["review"]:
                return httpx.Response(200, json=[{
                    "status": "decided", "storage_path": "p", "file_deleted_at": None,
                    "delete_after": "2026-11-04T00:00:00Z"}])
            return httpx.Response(200, json=[{"status": "decided", "storage_path": None,
                                              "file_deleted_at": "2026-10-21T00:00:00Z",
                                              "delete_after": None}])
        return httpx.Response(200, json=[]) if m == "GET" else httpx.Response(201, json=[])

    return handler, log


def run_smoke(tmp_path, decision_after=1, timeout=5.0):
    handler, log = fake_supabase(decision_after)
    s = smoke.Smoke("https://x.supabase.co", "svc", httpx.Client(
        transport=httpx.MockTransport(handler)))
    clip = smoke.make_clip(tmp_path / "c.mp4")
    s.setup(clip)
    return s, log


def test_make_clip_is_tiny_and_decodable(tmp_path):
    from quellix_worker import media

    clip = smoke.make_clip(tmp_path / "c.mp4")
    assert clip.stat().st_size < 200_000 and media.decode(clip).info.decodable


def test_pass_path_and_cleanup(tmp_path, monkeypatch):
    monkeypatch.setattr(smoke.time, "sleep", lambda s: None)
    s, log = run_smoke(tmp_path)
    s.verify(s.wait_for_decision(5))
    s.cleanup()
    sends = [r for r in log if r.url.path.endswith("/rpc/send")]
    assert json.loads(sends[0].content)["queue_name"] == "video_jobs"
    assert sends[0].headers["Content-Profile"] == "pgmq_public"
    deletes = [r.url.path for r in log if r.method == "DELETE"]
    assert deletes[-2:] == ["/rest/v1/videos", "/rest/v1/rubrics"]
    assert any("/storage/v1/object/videos/org/org1/" in str(r.url) for r in log)


def test_timeout_when_no_decision(tmp_path, monkeypatch):
    monkeypatch.setattr(smoke.time, "sleep", lambda s: None)
    t = iter(range(0, 1000, 100))
    monkeypatch.setattr(smoke.time, "monotonic", lambda: next(t))
    s, _ = run_smoke(tmp_path, decision_after=10_000)
    with pytest.raises(TimeoutError):
        s.wait_for_decision(250)


def test_skipped_without_credentials(monkeypatch, capsys):
    monkeypatch.delenv("SUPABASE_URL", raising=False)
    monkeypatch.delenv("SUPABASE_SERVICE_ROLE_KEY", raising=False)
    assert smoke.main([]) == smoke.EXIT_SKIPPED
    assert "SKIPPED" in capsys.readouterr().out


def test_review_file_is_kept_with_a_deadline(tmp_path, monkeypatch):
    monkeypatch.setattr(smoke.time, "sleep", lambda s: None)
    kept["review"] = True
    try:
        s, _ = run_smoke(tmp_path)
        s.verify(s.wait_for_decision(5))
    finally:
        kept["review"] = False
