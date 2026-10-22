"""Supabase adapter: plain httpx against PostgREST, Storage and pgmq (service-role key).

The worker is the only component that uses the service-role key; it bypasses RLS, so every
query here is explicit about ``org_id`` / ``video_id``.
"""

from __future__ import annotations

import hashlib
import hmac
import ipaddress
import json
import logging
import os
import socket
import time
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

import httpx

log = logging.getLogger(__name__)

QUEUE = "video_jobs"
BUCKET = "videos"  # private bucket, paths org/<org_id>/<video_id>/<filename>
# A crashed worker's message reappears after this; must exceed the Modal function timeout.
VISIBILITY_TIMEOUT_S = 2100
MAX_ATTEMPTS = 3
REVIEW_RETENTION = timedelta(days=14)  # founder data rule: a review video is kept at most this long
RETRY_DELAYS_S = (60, 300)  # wait before attempt 2 and 3
SIGNATURE_HEADER = "Ormes-Signature"
MAX_SOURCE_BYTES = 5 * 1024**3  # same cap as an upload (openapi CreateVideoRequest.size_bytes)


class UnsafeSourceError(ValueError):
    """A pilot ``source_url`` the worker refuses to fetch (not https, or not a public host)."""


def check_source_url(url: str, resolve: Any = None) -> list[str]:
    """Shadow pilots may point at the collector's own signed URLs (issue #65). Only https to a
    public address: never the metadata service, localhost or a private network (SSRF).
    -> the vetted IP addresses of the host; the download connects to one of them, so a DNS
    answer that changes after this check (rebinding) cannot redirect it."""
    parsed = httpx.URL(url)
    if parsed.scheme != "https" or not parsed.host:
        raise UnsafeSourceError("source_url must be an https URL")
    resolve = resolve or socket.getaddrinfo
    ips: list[str] = []
    for info in resolve(parsed.host, parsed.port or 443, proto=socket.IPPROTO_TCP):
        ip = ipaddress.ip_address(info[4][0])
        if not ip.is_global:
            raise UnsafeSourceError(f"source_url resolves to a non-public address ({ip})")
        ips.append(str(ip))
    if not ips:
        raise UnsafeSourceError("source_url host does not resolve")
    return ips


def sign(body: bytes, secret: str, timestamp: int | None = None) -> str:
    """``Ormes-Signature`` header value: ``t=<unix>,v1=<hex>`` where ``v1`` is the hex
    HMAC-SHA256 of ``"<t>.<raw body>"`` (the timestamp lets receivers reject replays)."""
    t = int(time.time()) if timestamp is None else timestamp
    digest = hmac.new(secret.encode(), f"{t}.".encode() + body, hashlib.sha256).hexdigest()
    return f"t={t},v1={digest}"


def _now() -> str:
    return datetime.now(UTC).isoformat()


@dataclass
class Job:
    msg_id: int
    job_id: str
    video_id: str


@dataclass
class JobContext:
    job: Job
    org_id: str
    storage_path: str | None
    filename: str | None
    rubric: dict[str, Any]
    attempts: int
    training_opt_in: bool
    allow_external_models: bool
    video_status: str = "queued"
    video_created_at: str | None = None
    external_id: str | None = None
    delete_after: str | None = None
    shadow: bool = False  # pilot video (issue #65): no webhooks
    source_url: str | None = None  # pilot video fetched from the collector's own URL


class SupabaseStore:
    def __init__(self, url: str | None = None, service_key: str | None = None,
                 client: httpx.Client | None = None) -> None:
        self._url = (url or os.environ["SUPABASE_URL"]).rstrip("/")
        key = service_key or os.environ["SUPABASE_SERVICE_ROLE_KEY"]
        self._h = {"apikey": key, "Authorization": f"Bearer {key}"}
        self._client = client or httpx.Client(timeout=60)

    # ------------------------------------------------------------------ helpers
    def _rest(self, method: str, table: str, *, params: dict[str, str] | None = None,
              json_body: Any = None, prefer: str | None = None) -> Any:
        headers = dict(self._h)
        if prefer:
            headers["Prefer"] = prefer
        resp = self._client.request(method, f"{self._url}/rest/v1/{table}", params=params,
                                    json=json_body, headers=headers)
        resp.raise_for_status()
        return resp.json() if resp.content else None

    def _pgmq(self, fn: str, body: dict[str, Any]) -> Any:
        resp = self._client.post(
            f"{self._url}/rest/v1/rpc/{fn}", json=body,
            headers={**self._h, "Content-Profile": "pgmq_public", "Accept-Profile": "pgmq_public"})
        resp.raise_for_status()
        return resp.json() if resp.content else None

    # ------------------------------------------------------------------ queue
    def read_job(self) -> Job | None:
        rows = self._pgmq("read", {"queue_name": QUEUE, "sleep_seconds": VISIBILITY_TIMEOUT_S,
                                   "n": 1})
        if not rows:
            return None
        msg = rows[0]["message"]
        return Job(rows[0]["msg_id"], msg["job_id"], msg["video_id"])

    def video_retention(self, video_id: str) -> tuple[str | None, str | None]:
        """-> (storage_path, delete_after) of a video row."""
        rows = self._rest("GET", "videos", params={"id": f"eq.{video_id}",
                                                   "select": "storage_path,delete_after"})
        return (rows[0]["storage_path"], rows[0]["delete_after"]) if rows else (None, None)

    def latest_decision(self, video_id: str) -> str | None:
        rows = self._rest("GET", "decisions", params={
            "video_id": f"eq.{video_id}", "select": "decision", "order": "created_at.desc",
            "limit": "1"})
        return rows[0]["decision"] if rows else None

    def keep_for_review(self, video_id: str) -> str:
        """Keep the file for a person to review; schedule its deletion. -> delete_after."""
        when = (datetime.now(UTC) + REVIEW_RETENTION).isoformat()
        self.set_video(video_id, delete_after=when)
        return when

    # ------------------------------------------------------------------ retention sweeps
    def purge_expired(self, now: datetime | None = None) -> list[str]:
        """Delete the file of every video whose ``delete_after`` has passed. -> video ids."""
        due = (now or datetime.now(UTC)).isoformat()
        rows = self._rest("GET", "videos", params={
            "select": "id,storage_path", "storage_path": "not.is.null",
            "delete_after": f"lt.{due}", "limit": "200"})
        return self._delete_files(rows)

    def purge_reviewed(self) -> list[str]:
        """Delete the file of every kept video that already has a review decision (a safety
        net: the review screen deletes it at review time)."""
        rows = self._rest("GET", "videos", params={
            "select": "id,storage_path,reviews!inner(id)", "storage_path": "not.is.null",
            "delete_after": "not.is.null", "limit": "200"})
        return self._delete_files(rows)

    def _delete_files(self, rows: list[dict[str, Any]]) -> list[str]:
        done = []
        for row in rows:
            try:
                self.delete_video_file(row["id"], row["storage_path"])
                done.append(row["id"])
            except Exception:  # one bad file must not stop the sweep; it is retried next run
                log.exception("could not delete the file of video %s", row["id"])
        return done

    def archive_job(self, job: Job) -> None:
        self._pgmq("archive", {"queue_name": QUEUE, "message_id": job.msg_id})

    def requeue_job(self, job: Job, delay_s: int) -> None:
        """Put the job back on the queue after ``delay_s`` (send first, then drop the old
        message, so a crash in between duplicates rather than loses the job)."""
        self._pgmq("send", {"queue_name": QUEUE, "message": {
            "job_id": job.job_id, "video_id": job.video_id}, "sleep_seconds": delay_s})
        self._pgmq("delete", {"queue_name": QUEUE, "message_id": job.msg_id})

    # ------------------------------------------------------------------ job data
    def load_context(self, job: Job) -> JobContext:
        jobs = self._rest("GET", "jobs", params={"id": f"eq.{job.job_id}", "select": "attempts"})
        videos = self._rest("GET", "videos", params={
            "id": f"eq.{job.video_id}",
            "select": "org_id,status,created_at,external_id,storage_path,filename,delete_after,"
                      "rubric_id,rubric_version,shadow,source_url,"
                      "organizations(training_opt_in,allow_external_models)"})
        if not jobs or not videos:
            raise LookupError(f"job {job.job_id} or video {job.video_id} not found")
        v = videos[0]
        if not v["storage_path"] and not v.get("source_url") \
                and v["status"] not in ("decided", "deleted"):
            raise LookupError(f"video {job.video_id} has no file")
        versions = self._rest("GET", "rubric_versions", params={
            "rubric_id": f"eq.{v['rubric_id']}", "version": f"eq.{v['rubric_version']}",
            "select": "body"})
        if not versions:
            raise LookupError("rubric version not found")
        rubric = {**versions[0]["body"], "id": str(v["rubric_id"]),
                  "version": int(v["rubric_version"])}
        return JobContext(job, v["org_id"], v["storage_path"], v["filename"], rubric,
                          jobs[0]["attempts"], bool(v["organizations"]["training_opt_in"]),
                          bool(v["organizations"]["allow_external_models"]),
                          v["status"], v["created_at"], v["external_id"], v["delete_after"],
                          bool(v.get("shadow")), v.get("source_url"))

    def start_job(self, job_id: str, attempts: int) -> None:
        self._rest("PATCH", "jobs", params={"id": f"eq.{job_id}"}, json_body={
            "status": "running", "started_at": _now(), "attempts": attempts + 1})

    def retry_job(self, job_id: str, error: str) -> None:
        self._rest("PATCH", "jobs", params={"id": f"eq.{job_id}"}, json_body={
            "status": "queued", "error": error})

    def finish_job(self, job_id: str, *, error: str | None = None,
                   cost_usd: float | None = None) -> None:
        self._rest("PATCH", "jobs", params={"id": f"eq.{job_id}"}, json_body={
            "status": "failed" if error else "succeeded", "error": error,
            "cost_usd": cost_usd, "finished_at": _now()})

    def set_video(self, video_id: str, **fields: Any) -> None:
        self._rest("PATCH", "videos", params={"id": f"eq.{video_id}"}, json_body=fields)

    # ------------------------------------------------------------------ storage
    def download(self, storage_path: str, dest: Path) -> Path:
        with self._client.stream("GET", f"{self._url}/storage/v1/object/{BUCKET}/{storage_path}",
                                 headers=self._h) as resp:
            resp.raise_for_status()
            with dest.open("wb") as fh:
                for chunk in resp.iter_bytes(1 << 20):
                    fh.write(chunk)
        return dest

    def forget_source_url(self, video_id: str) -> None:
        """Clear a pilot video's ``source_url`` (a signed URL is a credential)."""
        self._rest("PATCH", "videos", params={"id": f"eq.{video_id}",
                                              "source_url": "not.is.null"},
                   json_body={"source_url": None})

    def fetch_source(self, url: str, dest: Path, max_bytes: int = MAX_SOURCE_BYTES) -> Path:
        """Download a pilot video from the collector's signed URL into ``dest`` (a temporary
        directory, deleted with it). Never stored in our bucket; no redirects followed."""
        ip = check_source_url(url)[0]
        target = httpx.URL(url)
        # Connect to the vetted address, but keep the original name for the Host header and for
        # TLS (SNI + certificate check), so the collector's CDN still works.
        pinned = target.copy_with(host=ip)
        host_header = target.host if target.port is None else f"{target.host}:{target.port}"
        written = 0
        with self._client.stream("GET", pinned, headers={"Host": host_header},
                                 extensions={"sni_hostname": target.host},
                                 follow_redirects=False, timeout=600) as resp:
            if resp.is_redirect:
                raise UnsafeSourceError("source_url redirects; give the final URL")
            resp.raise_for_status()
            with dest.open("wb") as fh:
                for chunk in resp.iter_bytes(1 << 20):
                    written += len(chunk)
                    if written > max_bytes:
                        raise UnsafeSourceError("source_url file is larger than 5 GB")
                    fh.write(chunk)
        return dest

    def delete_video_file(self, video_id: str, storage_path: str) -> None:
        """Delete the customer's file from Storage, then record it on the video row."""
        resp = self._client.request("DELETE", f"{self._url}/storage/v1/object/{BUCKET}",
                                    json={"prefixes": [storage_path]}, headers=self._h)
        resp.raise_for_status()
        self.set_video(video_id, storage_path=None, file_deleted_at=_now())

    # ------------------------------------------------------------------ results
    def write_decision(self, org_id: str, decision: dict[str, Any]) -> dict[str, Any]:
        row = {
            "video_id": decision["video_id"], "org_id": org_id,
            "decision": decision["decision"], "reasons": decision["reasons"],
            "checks": decision["checks"], "rubric_id": decision["rubric"]["id"],
            "rubric_version": decision["rubric"]["version"],
            "engine_version": decision["engine_version"],
        }
        rows = self._rest("POST", "decisions", json_body=row, prefer="return=representation")
        return rows[0]

    # ------------------------------------------------------------------ webhooks
    def active_webhooks(self, org_id: str) -> list[dict[str, Any]]:
        return self._rest("GET", "webhooks", params={
            "org_id": f"eq.{org_id}", "active": "is.true", "select": "id,url,signing_secret"})

    def send_webhooks(self, org_id: str, video: dict[str, Any]) -> list[tuple[str, bool]]:
        """POST ``video.decided`` to every active webhook, signed with its ``signing_secret``.

        A webhook without a secret is not sent (warning logged); we never sign with
        ``secret_hash``. Failures are returned, not raised: a customer endpoint being down
        must not fail the job.
        """
        body = json.dumps({"type": "video.decided", "created_at": _now(), "data": video},
                          separators=(",", ":"), sort_keys=True).encode()
        results = []
        for hook in self.active_webhooks(org_id):
            if not hook.get("signing_secret"):
                log.warning("webhook %s has no signing_secret; not sending", hook["id"])
                continue
            try:
                r = self._client.post(hook["url"], content=body, timeout=15, headers={
                    "Content-Type": "application/json",
                    SIGNATURE_HEADER: sign(body, hook["signing_secret"])})
                results.append((hook["url"], r.is_success))
            except httpx.HTTPError:
                results.append((hook["url"], False))
        return results
