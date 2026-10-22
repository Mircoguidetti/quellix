import hashlib
import hmac
import json
import time

import httpx
import numpy as np

from quellix_worker.checks.originality import FrameFingerprint, SupabaseFingerprintStore
from quellix_worker.jobs import process_job
from quellix_worker.pipeline import Dependencies, PipelineConfig
from quellix_worker.store import Job, SupabaseStore, sign

from .clips import scene, write_clip


class Fake:
    """A tiny fake Supabase: records requests, answers from a script."""

    def __init__(self, video: bytes = b"", status: str = "queued", attempts: int = 0):
        self.status = status
        self.attempts = attempts
        self.log: list[httpx.Request] = []
        self.video = video
        self.webhook_bodies: list[tuple[bytes, str]] = []

    def __call__(self, req: httpx.Request) -> httpx.Response:
        self.log.append(req)
        p = req.url.path
        if p.endswith("/rpc/send") or p.endswith("/rpc/delete") or p.endswith("/rpc/archive"):
            return httpx.Response(200, json=[1])
        if p.endswith("/rpc/read"):
            return httpx.Response(200, json=[{"msg_id": 7,
                                              "message": {"job_id": "j1", "video_id": "v1"}}])
        if p.endswith("/rest/v1/jobs") and req.method == "GET":
            return httpx.Response(200, json=[{"attempts": self.attempts}])
        if p.endswith("/rest/v1/videos") and req.method == "GET":
            return httpx.Response(200, json=[{
                "org_id": "o1", "status": self.status, "created_at": "2026-10-21T00:00:00Z",
                "external_id": "ext1", "storage_path": "org/o1/v1/a.mp4", "filename": "a.mp4",
                "rubric_id": "r1", "rubric_version": 1,
                "organizations": {"training_opt_in": False,
                                  "allow_external_models": True}}])
        if p.endswith("/rubric_versions"):
            return httpx.Response(200, json=[{"body": RUBRIC_BODY}])
        if p.startswith("/storage/v1/object/videos/org") and req.method == "GET":
            return httpx.Response(200, content=self.video)
        if p == "/storage/v1/object/videos":
            return httpx.Response(200, json=[])
        if p.endswith("/decisions"):
            return httpx.Response(201, json=[{"id": "d1"}])
        if p.endswith("/webhooks"):
            return httpx.Response(200, json=[{"id": "w", "url": "https://hook.test/x",
                                              "signing_secret": "s3"}])
        if req.url.host == "hook.test":
            self.webhook_bodies.append((req.content, req.headers["Quellix-Signature"]))
            return httpx.Response(200)
        if p.endswith("/fingerprints"):
            return httpx.Response(200, json=[]) if req.method == "GET" else httpx.Response(201)
        return httpx.Response(204)


RUBRIC_BODY = {"name": "t", "task": {"description": "d"}, "checks": {"technical": {}}}


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
    assert not any(r.url.path.endswith("/decisions") for r in f.log)  # never a silent reject


def test_duplicate_delivery_only_cleans_up():
    f = Fake(b"", status="decided")
    assert process_job(make(f), Job(7, "j1", "v1"), _fp(f), PipelineConfig(),
                       Dependencies()) == "skipped"
    assert not any(r.url.path.endswith("/decisions") for r in f.log)
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
