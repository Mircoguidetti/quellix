import hashlib
import hmac
import json

import httpx
import numpy as np
import pytest

from quellix_worker.checks.originality import FrameFingerprint, SupabaseFingerprintStore
from quellix_worker.jobs import process_job
from quellix_worker.pipeline import Dependencies, PipelineConfig
from quellix_worker.store import SupabaseStore, sign

from .clips import scene, write_clip


class Fake:
    """A tiny fake Supabase: records requests, answers from a script."""

    def __init__(self, video: bytes = b""):
        self.log: list[httpx.Request] = []
        self.video = video
        self.webhook_bodies: list[tuple[bytes, str]] = []

    def __call__(self, req: httpx.Request) -> httpx.Response:
        self.log.append(req)
        p = req.url.path
        if p.endswith("/rpc/read"):
            return httpx.Response(200, json=[{"msg_id": 7,
                                              "message": {"job_id": "j1", "video_id": "v1"}}])
        if p.endswith("/rest/v1/jobs") and req.method == "GET":
            return httpx.Response(200, json=[{"attempts": 0}])
        if p.endswith("/rest/v1/videos") and req.method == "GET":
            return httpx.Response(200, json=[{
                "org_id": "o1", "storage_path": "org/o1/v1/a.mp4", "filename": "a.mp4",
                "rubric_id": "r1", "rubric_version": 1,
                "organizations": {"training_opt_in": False}}])
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
                                              "secret_hash": "s3"}])
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
    assert sign(b"{}", "k") == hmac.new(b"k", b"{}", hashlib.sha256).hexdigest()


def test_read_job_and_context():
    s = make(Fake())
    job = s.read_job()
    assert (job.msg_id, job.job_id, job.video_id) == (7, "j1", "v1")
    ctx = s.load_context(job)
    assert ctx.org_id == "o1" and ctx.rubric["id"] == "r1" and ctx.rubric["version"] == 1


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
    assert sig == sign(body, "s3") and json.loads(body)["type"] == "video.decided"
    fp_posts = [r for r in f.log if r.method == "POST" and r.url.path.endswith("/fingerprints")]
    assert fp_posts and all(row["org_id"] == "o1" for row in json.loads(fp_posts[0].content))


def test_job_failure_marks_failed():
    f = Fake(b"")  # empty download -> not decodable -> still a decision; force a crash instead
    s = make(f)

    def boom(*a, **k):
        raise RuntimeError("db down")

    s.write_decision = boom
    fp = SupabaseFingerprintStore("https://x.supabase.co", "svc", httpx.Client(
        transport=httpx.MockTransport(f)))
    with pytest.raises(RuntimeError):
        process_job(s, s.read_job(), fp, PipelineConfig(), Dependencies())
    bodies = [json.loads(r.content) for r in f.log
              if r.method == "PATCH" and r.url.path.endswith("/jobs") and r.content]
    assert bodies[-1]["status"] == "failed" and "db down" in bodies[-1]["error"]


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
    s.add("orgA", "v1", [FrameFingerprint(0.0, bytes(32), np.ones(3, dtype=np.float32))])
    assert json.loads(seen[-1].content)[0]["org_id"] == "orgA"
