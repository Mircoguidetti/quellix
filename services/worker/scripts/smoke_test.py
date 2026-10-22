"""End-to-end smoke test against a deployed worker.

Uploads a tiny generated clip for a dedicated test organisation through the same tables and
bucket the public API uses, enqueues it on ``video_jobs``, waits up to ``--timeout`` seconds
for a decision, asserts it is schema-valid and that the file was deleted, then cleans up.

    SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... uv run python scripts/smoke_test.py

Exit codes: 0 pass, 1 fail, 78 skipped (Supabase credentials missing).
"""

from __future__ import annotations

import argparse
import os
import sys
import tempfile
import time
import uuid
from fractions import Fraction
from pathlib import Path
from typing import Any

import httpx

from quellix_worker.contracts import validate_decision

ORG_NAME = "quellix-smoke-test"
RUBRIC_BODY = {
    "name": "smoke test",
    "task": {"description": "Smoke test clip. Any valid decision passes the test."},
    "checks": {"task_completed": {"enabled": False}, "hands_visible": {"enabled": False}},
}
EXIT_SKIPPED = 78


def make_clip(path: Path, frames: int = 40, size: tuple[int, int] = (160, 120)) -> Path:
    import av
    import numpy as np

    rng = np.random.default_rng(1)
    w, h = size
    base = rng.integers(0, 256, (h, w, 3), dtype=np.uint8)
    with av.open(str(path), "w") as out:
        stream = out.add_stream("libx264", rate=Fraction(10))
        stream.width, stream.height, stream.pix_fmt = w, h, "yuv420p"
        for i in range(frames):
            frame = np.roll(base, i * 2, axis=1)
            for pkt in stream.encode(av.VideoFrame.from_ndarray(frame, format="rgb24")):
                out.mux(pkt)
        for pkt in stream.encode():
            out.mux(pkt)
    return path


class SmokeError(Exception):
    """A failed stage, with a one-line reason that ends up in a GitHub annotation."""

    def __init__(self, stage: str, reason: str) -> None:
        super().__init__(f"[{stage}] {reason}")
        self.stage, self.reason = stage, reason


def _one_line(text: str, limit: int = 300) -> str:
    return " ".join(text.split())[:limit]


def _check(resp: httpx.Response, stage: str, what: str) -> httpx.Response:
    """Raise a SmokeError that names the call, the HTTP status and the response body."""
    if resp.is_success:
        return resp
    hint = ""
    if "PGRST106" in resp.text:  # PostgREST: schema not exposed
        hint = (" FIX: Supabase Dashboard > Project Settings > API > Exposed schemas: add"
                " pgmq_public, then Save.")
    raise SmokeError(stage, f"{what} -> HTTP {resp.status_code}: {_one_line(resp.text)}{hint}")


def annotation(stage: str, reason: str) -> str:
    """A GitHub Actions error annotation (readable through the API without job logs)."""
    esc = reason.replace("%", "%25").replace("\r", "%0D").replace("\n", "%0A")
    return f"::error title=Smoke test failed at {stage}::{esc}"


class Smoke:
    def __init__(self, url: str, key: str, client: httpx.Client | None = None) -> None:
        self.url = url.rstrip("/")
        self.h = {"apikey": key, "Authorization": f"Bearer {key}"}
        self.c = client or httpx.Client(timeout=60)
        self.org_id: str | None = None
        self.rubric_id: str | None = None
        self.video_id: str | None = None
        self.path: str | None = None
        self.job_id: str | None = None

    def rest(self, method: str, table: str, *, params: dict[str, str] | None = None,
             body: Any = None, rep: bool = False, stage: str = "supabase") -> Any:
        headers = {**self.h, **({"Prefer": "return=representation"} if rep else {})}
        try:
            r = self.c.request(method, f"{self.url}/rest/v1/{table}", params=params, json=body,
                               headers=headers)
        except httpx.HTTPError as exc:
            raise SmokeError(stage, f"{method} {table} -> {type(exc).__name__}: {exc}") from exc
        _check(r, stage, f"{method} {table}")
        return r.json() if r.content else None

    def setup(self, clip: Path) -> str:
        """-> job id. Creates org (reused), rubric, video row, uploads the file, enqueues."""
        orgs = self.rest("GET", "organizations", params={"name": f"eq.{ORG_NAME}",
                                                         "select": "id"}, stage="test org")
        self.org_id = orgs[0]["id"] if orgs else self.rest(
            "POST", "organizations", body={"name": ORG_NAME}, rep=True, stage="test org")[0]["id"]
        self.rubric_id = self.rest("POST", "rubrics", body={
            "org_id": self.org_id, "name": "smoke"}, rep=True, stage="rubric")[0]["id"]
        self.rest("POST", "rubric_versions", body={
            "rubric_id": self.rubric_id, "version": 1, "body": RUBRIC_BODY}, stage="rubric")
        self.video_id = str(uuid.uuid4())
        self.path = f"org/{self.org_id}/{self.video_id}/smoke.mp4"
        try:
            up = self.c.post(f"{self.url}/storage/v1/object/videos/{self.path}",
                             content=clip.read_bytes(),
                             headers={**self.h, "Content-Type": "video/mp4"})
        except httpx.HTTPError as exc:
            raise SmokeError("upload", f"Storage upload -> {type(exc).__name__}: {exc}") from exc
        _check(up, "upload", "Storage upload to bucket 'videos'")
        self.rest("POST", "videos", body={
            "id": self.video_id, "org_id": self.org_id, "rubric_id": self.rubric_id,
            "rubric_version": 1, "status": "queued", "storage_path": self.path,
            "filename": "smoke.mp4", "content_type": "video/mp4",
            "size_bytes": clip.stat().st_size}, stage="video row")
        self.job_id = self.rest("POST", "jobs", body={"video_id": self.video_id,
                                                      "status": "queued"},
                                rep=True, stage="job row")[0]["id"]
        try:
            q = self.c.post(f"{self.url}/rest/v1/rpc/send", headers={
                **self.h, "Content-Profile": "pgmq_public"},
                json={"queue_name": "video_jobs", "message": {
                    "job_id": self.job_id, "video_id": self.video_id}})
        except httpx.HTTPError as exc:
            raise SmokeError("enqueue", f"pgmq_public.send -> {type(exc).__name__}: {exc}") from exc
        _check(q, "enqueue", "pgmq_public.send on video_jobs")
        return self.job_id

    def diagnose(self) -> str:
        """Where the job is, for a timeout message: job row, video row, decision."""
        parts = []
        try:
            job = self.rest("GET", "jobs", params={"id": f"eq.{self.job_id}",
                                                   "select": "status,attempts,error"})
            video = self.rest("GET", "videos", params={
                "id": f"eq.{self.video_id}", "select": "status,storage_path,delete_after"})
            parts.append(f"job={job[0] if job else 'missing'}")
            parts.append(f"video={video[0] if video else 'missing'}")
        except Exception as exc:  # diagnostics must never hide the real failure
            parts.append(f"diagnostics unavailable: {_one_line(str(exc), 120)}")
        return "; ".join(parts)

    def wait_for_decision(self, timeout_s: float, poll_s: float = 5.0) -> dict[str, Any]:
        deadline = time.monotonic() + timeout_s
        while time.monotonic() < deadline:
            rows = self.rest("GET", "decisions", params={
                "video_id": f"eq.{self.video_id}", "select": "*", "limit": "1"})
            if rows:
                return rows[0]
            job = self.rest("GET", "jobs", params={"id": f"eq.{self.job_id}",
                                                   "select": "status,attempts,error"})
            if job and job[0]["status"] == "failed":  # no point waiting for the full timeout
                raise SmokeError("worker", f"the job failed after {job[0]['attempts']} "
                                           f"attempt(s): {_one_line(job[0]['error'] or '?')}")
            time.sleep(poll_s)
        state = self.diagnose()
        hint = ""
        if "'status': 'queued'" in state and "'attempts': 0" in state:
            hint = " (never picked up: is the poller deployed, and is pgmq_public exposed?)"
        raise SmokeError("wait for decision",
                         f"no decision after {timeout_s:.0f}s; {state}{hint}")

    def verify(self, row: dict[str, Any]) -> None:
        validate_decision({
            "video_id": row["video_id"], "decision": row["decision"], "reasons": row["reasons"],
            "checks": row["checks"],
            "rubric": {"id": str(row["rubric_id"]), "version": row["rubric_version"]},
            "engine_version": row["engine_version"]})
        assert str(row["rubric_id"]) == self.rubric_id, "decision carries the wrong rubric id"
        # Data rule: accept / reject -> the file is deleted once the decision exists (allow a
        # moment for the last steps); review -> kept for a person, with a deadline <= 14 days.
        select = "status,storage_path,file_deleted_at,delete_after"
        for _ in range(12):
            video = self.rest("GET", "videos", params={
                "id": f"eq.{self.video_id}", "select": select})[0]
            if video["file_deleted_at"] or (row["decision"] == "review" and video["delete_after"]):
                break
            time.sleep(5)
        assert video["status"] == "decided", f"video status is {video['status']}"
        if row["decision"] == "review":
            assert video["storage_path"] and video["delete_after"], "review file not kept"
        else:
            assert video["storage_path"] is None and video["file_deleted_at"], "file not deleted"

    def cleanup(self) -> None:
        """Best effort. Deleting the video cascades to jobs, decisions and fingerprints."""
        steps = [
            lambda: self.path and self.c.request(
                "DELETE", f"{self.url}/storage/v1/object/videos", json={"prefixes": [self.path]},
                headers=self.h),
            lambda: self.video_id and self.rest("DELETE", "videos", params={
                "id": f"eq.{self.video_id}"}),
            lambda: self.rubric_id and self.rest("DELETE", "rubrics", params={
                "id": f"eq.{self.rubric_id}"}),
        ]
        for step in steps:
            try:
                step()
            except Exception as exc:  # cleanup must never hide the test result
                print(f"cleanup warning: {exc}", file=sys.stderr)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--timeout", type=float, default=300.0)
    args = ap.parse_args(argv)
    url, key = os.environ.get("SUPABASE_URL"), os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        print("SKIPPED: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set")
        return EXIT_SKIPPED
    smoke = Smoke(url, key)
    stage, reason = "setup", ""
    try:
        with tempfile.TemporaryDirectory() as tmp:
            clip = make_clip(Path(tmp) / "smoke.mp4")
            smoke.setup(clip)
        row = smoke.wait_for_decision(args.timeout)
        stage = "verify"
        smoke.verify(row)
        print(f"PASS: decision={row['decision']} for video {smoke.video_id}")
        return 0
    except SmokeError as exc:
        stage, reason = exc.stage, exc.reason
    except AssertionError as exc:
        reason = str(exc) or "assertion failed"
    except Exception as exc:
        reason = f"{type(exc).__name__}: {_one_line(str(exc))}"
    finally:
        smoke.cleanup()
    print(f"FAIL [{stage}]: {reason}", file=sys.stderr)
    print(annotation(stage, reason))
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
