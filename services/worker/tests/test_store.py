import hashlib
import hmac
import json
import time
from datetime import UTC, datetime, timedelta
from pathlib import Path

import httpx
import numpy as np
import pytest

from quellix_worker import store as store_module
from quellix_worker.checks.originality import FrameFingerprint, SupabaseFingerprintStore
from quellix_worker.jobs import process_job
from quellix_worker.pipeline import Dependencies, PipelineConfig
from quellix_worker.store import Job, SupabaseStore, UnsafeSourceError, check_source_url, sign

from .clips import scene, write_clip


class Fake:
    """A tiny fake Supabase: records requests, answers from a script."""

    def __init__(self, video: bytes = b"", status: str = "queued", attempts: int = 0,
                 delete_after: str | None = None, last_decision: str | None = None,
                 due: list[dict] | None = None, video_fields: dict | None = None):
        self.status = status
        self.attempts = attempts
        self.delete_after = delete_after
        self.last_decision = last_decision
        self.due = due or []
        self.rubric = RUBRIC_BODY
        self.log: list[httpx.Request] = []
        self.video = video
        self.webhook_bodies: list[tuple[bytes, str]] = []
        self.video_fields = video_fields or {}
        self.source_gets: list[tuple[str, str]] = []
        self.requests_to_source: list[httpx.Request] = []

    def __call__(self, req: httpx.Request) -> httpx.Response:
        self.log.append(req)
        p = req.url.path
        if (p.endswith("/rest/v1/videos") and req.method == "GET"
                and "delete_after" in req.url.params):
            return httpx.Response(200, json=self.due)
        if p.endswith("/rpc/send") or p.endswith("/rpc/delete") or p.endswith("/rpc/archive"):
            return httpx.Response(200, json=[1])
        if p.endswith("/rpc/read"):
            return httpx.Response(200, json=[{"msg_id": 7,
                                              "message": {"job_id": "j1", "video_id": "v1"}}])
        if p.endswith("/rest/v1/jobs") and req.method == "GET":
            return httpx.Response(200, json=[{"attempts": self.attempts}])
        if p.endswith("/rest/v1/videos") and req.method == "GET" and "select" in req.url.params \
                and req.url.params["select"] == "storage_path,delete_after":
            return httpx.Response(200, json=[{
                "storage_path": self.video_fields.get("storage_path", "org/o1/v1/a.mp4"),
                "delete_after": self.delete_after}])
        if p.endswith("/rest/v1/videos") and req.method == "GET":
            return httpx.Response(200, json=[{
                "org_id": "o1", "status": self.status, "created_at": "2026-10-21T00:00:00Z",
                "external_id": "ext1", "delete_after": self.delete_after,
                "storage_path": "org/o1/v1/a.mp4", "filename": "a.mp4",
                "rubric_id": "r1", "rubric_version": 1,
                "organizations": {"training_opt_in": False,
                                  "allow_external_models": True}, **self.video_fields}])
        if p.endswith("/rubric_versions"):
            return httpx.Response(200, json=[{"body": self.rubric}])
        if p.startswith("/storage/v1/object/videos/org") and req.method == "GET":
            return httpx.Response(200, content=self.video)
        if p == "/storage/v1/object/videos":
            return httpx.Response(200, json=[])
        if p.endswith("/decisions") and req.method == "GET":
            return httpx.Response(200, json=(
                [{"decision": self.last_decision}] if self.last_decision else []))
        if p.endswith("/decisions"):
            return httpx.Response(201, json=[{"id": "d1"}])
        if p.endswith("/webhooks"):
            return httpx.Response(200, json=[{"id": "w", "url": "https://hook.test/x",
                                              "signing_secret": "s3"}])
        if req.headers.get("host", "").startswith("cdn.collector.test"):
            # the worker connects to the vetted IP and keeps the name in Host / SNI
            self.requests_to_source.append(req)
            self.source_gets.append((req.headers["host"], req.url.raw_path.decode()))
            if req.url.path.endswith("/moved.mp4"):
                return httpx.Response(302, headers={"location": "http://169.254.169.254/"})
            return httpx.Response(200, content=self.video)
        if req.url.host == "hook.test":
            self.webhook_bodies.append((req.content, req.headers["Ormes-Signature"]))
            return httpx.Response(200)
        if p.endswith("/fingerprints"):
            return httpx.Response(200, json=[]) if req.method == "GET" else httpx.Response(201)
        return httpx.Response(204)


# Only technical is on, so a good clip is `accept`; with HANDS_ON the hands placeholder sends
# it to `review` (no hands model yet).
OFF = {"enabled": False}
RUBRIC_BODY = {"name": "t", "task": {"description": "d"}, "checks": {
    "technical": {}, "task_completed": OFF, "hands_visible": OFF, "framing": OFF,
    "privacy": OFF, "originality": OFF}}
HANDS_ON = {**RUBRIC_BODY, "checks": {**RUBRIC_BODY["checks"], "hands_visible": {}}}


def make(fake):
    return SupabaseStore("https://x.supabase.co", "svc", httpx.Client(
        transport=httpx.MockTransport(fake)))


def test_sign_matches_hmac_sha256():
    header = sign(b'{"a":1}', "k", timestamp=1700000000)
    expected = hmac.new(b"k", b'1700000000.{"a":1}', hashlib.sha256).hexdigest()
    assert header == f"t=1700000000,v1={expected}"


def verify(header: str, body: bytes, secret: str, now: int, tolerance: int = 300) -> bool:
    """What a receiver does (the contract in openapi.yaml)."""
    parts = dict(p.split("=", 1) for p in header.split(","))
    t = int(parts["t"])
    good = hmac.new(secret.encode(), f"{t}.".encode() + body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(good, parts["v1"]) and abs(now - t) <= tolerance


def test_signature_verifies_and_rejects_replay_and_tampering():
    body = b'{"type":"video.decided"}'
    header = sign(body, "secret", timestamp=1000)
    assert verify(header, body, "secret", now=1100)
    assert not verify(header, body, "secret", now=1000 + 301)  # replay
    assert not verify(header, body + b" ", "secret", now=1100)  # tampered body
    assert not verify(header, body, "other", now=1100)  # wrong secret
    assert not verify(f"t=1001,v1={header.split('v1=')[1]}", body, "secret", now=1100)


def test_read_job_and_context():
    s = make(Fake())
    job = s.read_job()
    assert (job.msg_id, job.job_id, job.video_id) == (7, "j1", "v1")
    ctx = s.load_context(job)
    assert ctx.org_id == "o1" and ctx.rubric["id"] == "r1" and ctx.rubric["version"] == 1
    assert ctx.allow_external_models is True


def test_service_key_sent():
    f = Fake()
    make(f).read_job()
    assert f.log[0].headers["apikey"] == "svc"
    assert f.log[0].headers["Content-Profile"] == "pgmq_public"


def test_process_job_end_to_end(tmp_path):
    clip = write_clip(tmp_path / "a.mp4", scene(1, 40))
    f = Fake(clip.read_bytes())
    s = make(f)
    rubric_fp = SupabaseFingerprintStore("https://x.supabase.co", "svc", httpx.Client(
        transport=httpx.MockTransport(f)))
    deps = Dependencies(face_detector=type("F", (), {"detect": lambda self, rgb: []})())
    out = process_job(s, s.read_job(), rubric_fp, PipelineConfig(), deps)
    assert out in {"accept", "reject", "review"}
    methods = [(r.method, r.url.path) for r in f.log]
    dec = methods.index(("POST", "/rest/v1/decisions"))
    delete = methods.index(("DELETE", "/storage/v1/object/videos"))
    assert dec < delete  # decision is written before the file is deleted
    patches = [json.loads(r.content) for r in f.log
               if r.method == "PATCH" and r.url.path.endswith("/videos")]
    assert any(p.get("storage_path", 1) is None and p.get("file_deleted_at") for p in patches)
    body, sig = f.webhook_bodies[0]
    payload = json.loads(body)
    assert verify(sig, body, "s3", now=int(time.time())) and payload["type"] == "video.decided"
    video = payload["data"]  # the OpenAPI Video object
    assert {"id", "status", "rubric_id", "rubric_version", "created_at"} <= set(video)
    assert video["created_at"] == "2026-10-21T00:00:00Z" and video["decision"]["video_id"] == "v1"
    fp_posts = [r for r in f.log if r.method == "POST" and r.url.path.endswith("/fingerprints")]
    assert fp_posts and all(row["org_id"] == "o1" for row in json.loads(fp_posts[0].content))


def _fp(f):
    return SupabaseFingerprintStore("https://x.supabase.co", "svc", httpx.Client(
        transport=httpx.MockTransport(f)))


def _boom_store(f):
    s = make(f)

    def boom(*a, **k):
        raise RuntimeError("db down")

    s.write_decision = boom
    return s


def _bodies(f, suffix, method="PATCH"):
    return [json.loads(r.content) for r in f.log
            if r.method == method and r.url.path.endswith(suffix) and r.content]


def test_failure_is_retried_with_delay():
    f = Fake(b"")
    assert process_job(_boom_store(f), Job(7, "j1", "v1"), _fp(f), PipelineConfig(),
                       Dependencies()) == "retry"
    assert _bodies(f, "/jobs")[-1] == {"status": "queued", "error": "RuntimeError: db down"}
    assert _bodies(f, "/videos")[-1] == {"status": "queued"}
    assert not any(r.method == "DELETE" and r.url.path == "/storage/v1/object/videos"
                   for r in f.log)  # still needed for the next attempt
    sent = _bodies(f, "/rpc/send", "POST")
    assert sent[0]["message"] == {"job_id": "j1", "video_id": "v1"}
    assert sent[0]["sleep_seconds"] == 60
    assert any(r.url.path.endswith("/rpc/delete") for r in f.log)  # old message dropped
    assert not any(r.url.path.endswith("/rpc/archive") for r in f.log)


def test_third_failure_marks_failed_and_archives():
    f = Fake(b"", attempts=2)
    assert process_job(_boom_store(f), Job(7, "j1", "v1"), _fp(f), PipelineConfig(),
                       Dependencies()) == "failed"
    job_patch = _bodies(f, "/jobs")[-1]
    assert job_patch["status"] == "failed" and "db down" in job_patch["error"]
    assert {"status": "failed"} in _bodies(f, "/videos")
    assert any(r.url.path.endswith("/rpc/archive") for r in f.log)
    # the customer file is deleted on the final failure too, and the row records it
    assert any(r.method == "DELETE" and r.url.path == "/storage/v1/object/videos" for r in f.log)
    assert any(b.get("storage_path", 1) is None and b.get("file_deleted_at")
               for b in _bodies(f, "/videos"))
    assert not any(r.url.path.endswith("/rpc/send") for r in f.log)
    assert not any(r.method == "POST" and r.url.path.endswith("/decisions")
                   for r in f.log)  # never a silent reject


def test_duplicate_delivery_only_cleans_up():
    f = Fake(b"", status="decided")
    assert process_job(make(f), Job(7, "j1", "v1"), _fp(f), PipelineConfig(),
                       Dependencies()) == "skipped"
    assert not any(r.method == "POST" and r.url.path.endswith("/decisions") for r in f.log)
    assert any(r.method == "DELETE" and r.url.path == "/storage/v1/object/videos" for r in f.log)
    assert any(r.url.path.endswith("/rpc/archive") for r in f.log)


def test_webhook_failure_does_not_fail_the_job(tmp_path):
    clip = write_clip(tmp_path / "a.mp4", scene(1, 20))
    f = Fake(clip.read_bytes())
    s = make(f)

    def down(*a, **k):
        raise httpx.ConnectError("down")

    s.send_webhooks = down
    deps = Dependencies(face_detector=type("F", (), {"detect": lambda self, rgb: []})())
    out = process_job(s, Job(7, "j1", "v1"), _fp(f), PipelineConfig(), deps)
    assert out in {"accept", "reject", "review"}
    assert any(r.url.path.endswith("/rpc/archive") for r in f.log)


def test_fingerprint_store_scoped_by_org():
    seen = []

    def handler(req: httpx.Request) -> httpx.Response:
        seen.append(req)
        if req.method == "GET":
            return httpx.Response(200, json=[{"video_id": "v9", "pdq": "\\x" + "00" * 32}])
        return httpx.Response(201)

    s = SupabaseFingerprintStore("https://x.supabase.co", "svc",
                                 httpx.Client(transport=httpx.MockTransport(handler)))
    idx = s.index("orgA")
    assert seen[0].url.params["org_id"] == "eq.orgA" and len(idx) == 1
    s.add("orgA", "v1", [FrameFingerprint(0.0, pdq=bytes(32)),
                         FrameFingerprint(0.0, embedding=np.ones(3, dtype=np.float32),
                                          model="dinov2-vits14")])
    rows = json.loads(seen[-1].content)
    assert all(r["org_id"] == "orgA" for r in rows)
    assert rows[0]["embedding"] is None and rows[0]["model"] == "pdq"  # no zero vectors
    assert rows[1]["pdq"] is None and rows[1]["model"] == "dinov2-vits14"


def test_embedding_match_uses_rpc_scoped_to_org():
    seen = []

    def handler(req: httpx.Request) -> httpx.Response:
        seen.append(req)
        return httpx.Response(200, json=[{"video_id": "v2", "t_s": 1.0, "similarity": 0.97}])

    s = SupabaseFingerprintStore("https://x.supabase.co", "svc",
                                 httpx.Client(transport=httpx.MockTransport(handler)))
    m = s.match_embedding("orgA", np.ones(3, dtype=np.float32), "v1")
    body = json.loads(seen[0].content)
    assert seen[0].url.path.endswith("/rpc/match_fingerprints")
    assert body["p_org"] == "orgA" and body["p_exclude_video"] == "v1"
    assert m[0].video_id == "v2" and m[0].similarity == 0.97


def test_webhook_without_secret_is_not_sent(caplog):
    f = Fake()
    orig = f.__call__

    def with_null(req):
        if req.url.path.endswith("/webhooks"):
            f.log.append(req)
            return httpx.Response(200, json=[{"id": "w", "url": "https://hook.test/x",
                                              "signing_secret": None}])
        return orig(req)

    s = SupabaseStore("https://x.supabase.co", "svc",
                      httpx.Client(transport=httpx.MockTransport(with_null)))
    assert s.send_webhooks("o1", {"id": "v1"}) == []
    assert f.webhook_bodies == [] and "no signing_secret" in caplog.text


def test_external_models_need_org_and_global_switch(tmp_path, monkeypatch):
    from quellix_worker import jobs

    seen = []

    def fake_run(path, rubric, vid, cfg, deps):
        seen.append(cfg.allow_external_models)
        raise RuntimeError("stop")

    monkeypatch.setattr(jobs, "run_pipeline", fake_run)
    clip = write_clip(tmp_path / "a.mp4", scene(1, 20))
    for org_allows, switch in [(True, True), (True, False), (False, True)]:
        f = Fake(clip.read_bytes())
        s = make(f)
        orig_ctx = s.load_context

        def ctx(job, orig_ctx=orig_ctx, org_allows=org_allows):
            c = orig_ctx(job)
            c.allow_external_models = org_allows
            return c

        s.load_context = ctx
        process_job(s, s.read_job(), _fp(f), PipelineConfig(allow_external_models=switch),
                    Dependencies())
    assert seen == [True, False, False]


# --- retention: review videos are kept (<= 14 days), everything else is deleted --------------


def _run(f, tmp_path=None):
    deps = Dependencies(face_detector=type("F", (), {"detect": lambda self, rgb: []})())
    return process_job(make(f), Job(7, "j1", "v1"), _fp(f), PipelineConfig(), deps)


def _storage_deletes(f):
    return [r for r in f.log if r.method == "DELETE" and r.url.path == "/storage/v1/object/videos"]


def _video_patches(f):
    return _bodies(f, "/videos")


@pytest.fixture(scope="module")
def good_clip(tmp_path_factory):
    return write_clip(tmp_path_factory.mktemp("ret") / "a.mp4", scene(1, 30), fps=15).read_bytes()


def test_accept_is_deleted_immediately(good_clip):
    f = Fake(good_clip)
    assert _run(f) == "accept"
    assert len(_storage_deletes(f)) == 1
    assert not any("delete_after" in b for b in _video_patches(f))


def test_reject_is_deleted_immediately():
    f = Fake(b"not a video")  # undecodable -> reject
    assert _run(f) == "reject"
    assert len(_storage_deletes(f)) == 1
    assert not any("delete_after" in b for b in _video_patches(f))


def test_review_is_kept_for_at_most_14_days(good_clip):
    f = Fake(good_clip)
    f.rubric = HANDS_ON
    before = datetime.now(UTC)
    assert _run(f) == "review"
    assert _storage_deletes(f) == []  # the reviewer can still watch it
    patches = _video_patches(f)
    deadline = datetime.fromisoformat(next(b["delete_after"] for b in patches
                                           if "delete_after" in b))
    assert timedelta(days=13, hours=23) < deadline - before <= timedelta(days=14, minutes=1)
    assert any(b.get("status") == "decided" for b in patches)
    assert not any(b.get("storage_path", 1) is None for b in patches)  # the row keeps the path
    decisions = [r for r in f.log if r.method == "POST" and r.url.path.endswith("/decisions")]
    assert json.loads(decisions[0].content)["decision"] == "review"  # decision still stored


def test_final_failure_deletes_the_file():
    f = Fake(b"", attempts=2)
    assert process_job(_boom_store(f), Job(7, "j1", "v1"), _fp(f), PipelineConfig(),
                       Dependencies()) == "failed"
    assert len(_storage_deletes(f)) == 1


def test_final_failure_after_a_kept_review_does_not_delete_the_file():
    f = Fake(b"", attempts=2, delete_after="2026-11-01T00:00:00+00:00")
    assert process_job(_boom_store(f), Job(7, "j1", "v1"), _fp(f), PipelineConfig(),
                       Dependencies()) == "failed"
    assert _storage_deletes(f) == []


@pytest.mark.parametrize("last,kept", [("review", True), ("accept", False), ("reject", False)])
def test_duplicate_delivery_respects_the_decision(last, kept):
    f = Fake(b"", status="decided", last_decision=last)
    assert process_job(make(f), Job(7, "j1", "v1"), _fp(f), PipelineConfig(),
                       Dependencies()) == "skipped"
    assert bool(_storage_deletes(f)) is (not kept)
    assert any("delete_after" in b for b in _video_patches(f)) is kept


def test_duplicate_delivery_never_deletes_a_kept_review_file():
    f = Fake(b"", status="decided", delete_after="2026-11-01T00:00:00+00:00",
             last_decision="review")
    process_job(make(f), Job(7, "j1", "v1"), _fp(f), PipelineConfig(), Dependencies())
    assert _storage_deletes(f) == []


def test_purge_expired_deletes_only_what_is_due():
    f = Fake(due=[{"id": "v9", "storage_path": "org/o1/v9/a.mp4"}])
    now = datetime(2026, 11, 5, tzinfo=UTC)
    assert make(f).purge_expired(now) == ["v9"]
    get = next(r for r in f.log if r.method == "GET" and r.url.path.endswith("/videos"))
    assert get.url.params["delete_after"] == f"lt.{now.isoformat()}"
    assert get.url.params["storage_path"] == "not.is.null"
    assert len(_storage_deletes(f)) == 1
    assert any(b.get("storage_path", 1) is None for b in _video_patches(f))
    assert any(b.get("file_deleted_at") for b in _video_patches(f))


def test_purge_reviewed_targets_kept_videos_with_a_review():
    f = Fake(due=[{"id": "v8", "storage_path": "org/o1/v8/a.mp4", "reviews": [{"id": "r"}]}])
    assert make(f).purge_reviewed() == ["v8"]
    get = next(r for r in f.log if r.method == "GET" and r.url.path.endswith("/videos"))
    assert "reviews!inner" in get.url.params["select"]
    assert get.url.params["delete_after"] == "not.is.null"


def test_a_failing_file_does_not_stop_the_sweep():
    f = Fake(due=[{"id": "a", "storage_path": "p/a"}, {"id": "b", "storage_path": "p/b"}])
    s = make(f)
    real = s.delete_video_file
    calls = []

    def flaky(video_id, path):
        calls.append(video_id)
        if video_id == "a":
            raise httpx.ConnectError("down")
        real(video_id, path)

    s.delete_video_file = flaky
    assert s.purge_expired() == ["b"] and calls == ["a", "b"]


def test_nothing_in_the_worker_deletes_rows_we_keep():
    """Decisions, fingerprints, rubric versions, reviews and lab outcomes are never deleted by
    the worker: the only DELETEs it issues are Storage objects and queue messages."""
    import re

    src = "".join(p.read_text() for p in Path(__file__).parents[1].joinpath("src").rglob("*.py"))
    assert not re.search(r'_rest\(\s*"DELETE"', src)
    assert not re.search(r'request\(\s*"DELETE",\s*f?"[^"]*/rest/v1', src)


def test_modal_sweep_runs_both_purges(monkeypatch):
    from quellix_worker import modal_app, store

    monkeypatch.setenv("SUPABASE_URL", "https://x.supabase.co")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "k")
    monkeypatch.setattr(store.SupabaseStore, "purge_expired", lambda self: ["a", "b"])
    monkeypatch.setattr(store.SupabaseStore, "purge_reviewed", lambda self: ["c"])
    assert modal_app.sweep() == {"expired": 2, "reviewed": 1}


# ---------------------------------------------------------------- shadow pilots (issue #65)

PUBLIC = [(2, 1, 6, "", ("93.184.216.34", 443))]


def _run(f):
    s = make(f)
    deps = Dependencies(face_detector=type("F", (), {"detect": lambda self, rgb: []})())
    return process_job(s, s.read_job(), _fp(f), PipelineConfig(), deps)


def test_shadow_video_sends_no_webhook(tmp_path):
    clip = write_clip(tmp_path / "a.mp4", scene(1, 40))
    f = Fake(clip.read_bytes(), video_fields={"shadow": True})
    assert _run(f) in {"accept", "reject", "review"}
    assert f.webhook_bodies == []
    assert any(r.method == "POST" and r.url.path.endswith("/decisions") for r in f.log)


def test_regular_video_still_sends_its_webhook(tmp_path):
    clip = write_clip(tmp_path / "a.mp4", scene(1, 40))
    f = Fake(clip.read_bytes(), video_fields={"shadow": False})
    _run(f)
    assert len(f.webhook_bodies) == 1


def test_source_url_is_fetched_to_temp_and_never_stored(tmp_path, monkeypatch):
    monkeypatch.setattr(store_module.socket, "getaddrinfo", lambda *a, **k: PUBLIC)
    clip = write_clip(tmp_path / "a.mp4", scene(1, 40))
    url = "https://cdn.collector.test/batch/a.mp4?sig=abc"
    f = Fake(clip.read_bytes(), video_fields={"shadow": True, "storage_path": None,
                                              "source_url": url})
    assert _run(f) in {"accept", "reject", "review"}
    assert f.source_gets == [("cdn.collector.test", "/batch/a.mp4?sig=abc")]
    paths = [(r.method, r.url.path) for r in f.log]
    # Nothing read from or written to our bucket.
    assert not any(p.startswith("/storage/") for _, p in paths)
    patches = _bodies(f, "/videos")
    # The signed URL is the collector's credential: forgotten once the decision is written.
    assert any(p.get("status") == "decided" and p.get("source_url", 1) is None for p in patches)


def test_check_source_url_refuses_unsafe_targets():
    def resolver(ip):
        return lambda *a, **k: [(2, 1, 6, "", (ip, 443))]

    check_source_url("https://cdn.collector.test/a.mp4", resolve=resolver("93.184.216.34"))
    for url, ip in [("http://cdn.collector.test/a.mp4", "93.184.216.34"),
                    ("https://meta.test/a", "169.254.169.254"),
                    ("https://intra.test/a", "10.0.0.5"),
                    ("https://local.test/a", "127.0.0.1"),
                    ("https://v6.test/a", "::1")]:
        with pytest.raises(UnsafeSourceError):
            check_source_url(url, resolve=resolver(ip))


def test_fetch_source_refuses_redirects_and_oversized_files(tmp_path, monkeypatch):
    monkeypatch.setattr(store_module.socket, "getaddrinfo", lambda *a, **k: PUBLIC)
    s = make(Fake(b"x" * 4096))
    with pytest.raises(UnsafeSourceError, match="redirects"):
        s.fetch_source("https://cdn.collector.test/moved.mp4", tmp_path / "a.mp4")
    with pytest.raises(UnsafeSourceError, match="larger"):
        s.fetch_source("https://cdn.collector.test/big.mp4", tmp_path / "b.mp4", max_bytes=1000)


def test_fetch_connects_to_the_vetted_ip_with_the_original_name(tmp_path, monkeypatch):
    """DNS rebinding: the name is resolved once, vetted, and the download connects to that
    address (the name stays in Host and TLS SNI), so a second, different answer is never used."""
    answers = iter([PUBLIC, [(2, 1, 6, "", ("169.254.169.254", 443))]])
    monkeypatch.setattr(store_module.socket, "getaddrinfo", lambda *a, **k: next(answers))
    f = Fake(b"video-bytes")
    out = make(f).fetch_source("https://cdn.collector.test/batch/a.mp4?sig=abc", tmp_path / "a")
    assert out.read_bytes() == b"video-bytes"
    (req,) = f.requests_to_source
    assert req.url.host == "93.184.216.34"  # the vetted address, not the name
    assert req.headers["host"] == "cdn.collector.test"
    assert req.extensions["sni_hostname"] == "cdn.collector.test"
    assert "apikey" not in req.headers and "authorization" not in req.headers  # no service key
    assert next(answers)  # the second (malicious) answer was never consumed


def test_a_host_that_resolves_to_nothing_is_refused():
    with pytest.raises(UnsafeSourceError, match="does not resolve"):
        check_source_url("https://nowhere.test/a", resolve=lambda *a, **k: [])


def test_final_failure_forgets_the_source_url():
    f = Fake(b"", attempts=2, video_fields={"shadow": True, "storage_path": None,
                                             "source_url": "https://cdn.collector.test/a.mp4"})
    s = make(f)

    def boom(*a, **k):
        raise RuntimeError("fetch failed")

    s.fetch_source = boom
    deps = Dependencies(face_detector=type("F", (), {"detect": lambda self, rgb: []})())
    assert process_job(s, s.read_job(), _fp(f), PipelineConfig(), deps) == "failed"
    cleared = [r for r in f.log if r.method == "PATCH" and r.url.path.endswith("/videos")
               and r.url.params.get("source_url") == "not.is.null"]
    assert cleared and json.loads(cleared[0].content) == {"source_url": None}
    assert not any(r.method == "DELETE" and r.url.path == "/storage/v1/object/videos"
                   for r in f.log)  # nothing of theirs was ever in our bucket
