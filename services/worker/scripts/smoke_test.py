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


class Smoke:
    def __init__(self, url: str, key: str, client: httpx.Client | None = None) -> None:
        self.url = url.rstrip("/")
        self.h = {"apikey": key, "Authorization": f"Bearer {key}"}
        self.c = client or httpx.Client(timeout=60)
        self.org_id: str | None = None
        self.rubric_id: str | None = None
        self.video_id: str | None = None
        self.path: str | None = None

    def rest(self, method: str, table: str, *, params: dict[str, str] | None = None,
             body: Any = None, rep: bool = False) -> Any:
        headers = {**self.h, **({"Prefer": "return=representation"} if rep else {})}
        r = self.c.request(method, f"{self.url}/rest/v1/{table}", params=params, json=body,
                           headers=headers)
        r.raise_for_status()
        return r.json() if r.content else None

    def setup(self, clip: Path) -> str:
        """-> job id. Creates org (reused), rubric, video row, uploads the file, enqueues."""
        orgs = self.rest("GET", "organizations", params={"name": f"eq.{ORG_NAME}", "select": "id"})
        self.org_id = orgs[0]["id"] if orgs else self.rest(
            "POST", "organizations", body={"name": ORG_NAME}, rep=True)[0]["id"]
        self.rubric_id = self.rest("POST", "rubrics", body={
            "org_id": self.org_id, "name": "smoke"}, rep=True)[0]["id"]
        self.rest("POST", "rubric_versions", body={
            "rubric_id": self.rubric_id, "version": 1, "body": RUBRIC_BODY})
        self.video_id = str(uuid.uuid4())
        self.path = f"org/{self.org_id}/{self.video_id}/smoke.mp4"
        up = self.c.post(f"{self.url}/storage/v1/object/videos/{self.path}",
                         content=clip.read_bytes(),
                         headers={**self.h, "Content-Type": "video/mp4"})
        up.raise_for_status()
        self.rest("POST", "videos", body={
            "id": self.video_id, "org_id": self.org_id, "rubric_id": self.rubric_id,
            "rubric_version": 1, "status": "queued", "storage_path": self.path,
            "filename": "smoke.mp4", "content_type": "video/mp4",
            "size_bytes": clip.stat().st_size})
        job_id = self.rest("POST", "jobs", body={"video_id": self.video_id, "status": "queued"},
                           rep=True)[0]["id"]
        q = self.c.post(f"{self.url}/rest/v1/rpc/send", headers={
            **self.h, "Content-Profile": "pgmq_public"},
            json={"queue_name": "video_jobs", "message": {
                "job_id": job_id, "video_id": self.video_id}})
        q.raise_for_status()
        return job_id

    def wait_for_decision(self, timeout_s: float, poll_s: float = 5.0) -> dict[str, Any]:
        deadline = time.monotonic() + timeout_s
        while time.monotonic() < deadline:
            rows = self.rest("GET", "decisions", params={
                "video_id": f"eq.{self.video_id}", "select": "*", "limit": "1"})
            if rows:
                return rows[0]
            time.sleep(poll_s)
        raise TimeoutError(f"no decision after {timeout_s:.0f}s")

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
    try:
        with tempfile.TemporaryDirectory() as tmp:
            clip = make_clip(Path(tmp) / "smoke.mp4")
            smoke.setup(clip)
        row = smoke.wait_for_decision(args.timeout)
        smoke.verify(row)
        print(f"PASS: decision={row['decision']} for video {smoke.video_id}")
        return 0
    except Exception as exc:
        print(f"FAIL: {type(exc).__name__}: {exc}", file=sys.stderr)
        return 1
    finally:
        smoke.cleanup()


if __name__ == "__main__":
    raise SystemExit(main())
