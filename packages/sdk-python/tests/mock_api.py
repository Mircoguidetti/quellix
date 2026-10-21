"""A mock Quellix API built from packages/contracts/openapi.yaml.

Routes, success status codes and request-body validation come from the spec; response bodies
come from small stateful handlers. Used through httpx.MockTransport (sync and async).
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import httpx
import yaml

SPEC: dict[str, Any] = yaml.safe_load(
    (Path(__file__).parents[2] / "contracts" / "openapi.yaml").read_text()
)
BASE = "http://mock.test/api/v1"
API_KEY = "qx_live_test"


@dataclass
class Operation:
    id: str
    method: str
    pattern: re.Pattern[str]
    success_status: int
    body_schema: dict[str, Any] | None


def _build_operations() -> list[Operation]:
    ops: list[Operation] = []
    for template, item in SPEC["paths"].items():
        pattern = re.compile("^" + re.sub(r"\{(\w+)\}", r"([^/]+)", template) + "$")
        for method in ("get", "post", "put"):
            op = item.get(method)
            if not op:
                continue
            success = next(int(c) for c in op["responses"] if str(c).startswith("2"))
            content = op.get("requestBody", {}).get("content", {})
            schema = content.get("application/json", {}).get("schema")
            ops.append(Operation(op["operationId"], method.upper(), pattern, success, schema))
    return ops


OPERATIONS = _build_operations()


def _resolve(schema: dict[str, Any]) -> dict[str, Any]:
    ref = schema.get("$ref")
    if not ref:
        return schema
    node: Any = SPEC
    for key in ref.removeprefix("#/").split("/"):
        node = node[key]
    return _resolve(node)


def validate(value: Any, raw: dict[str, Any], path: str = "body") -> list[str]:
    """Validate the JSON-Schema subset the contract uses for request bodies."""
    schema = _resolve(raw)
    errors: list[str] = []
    if "enum" in schema and value not in schema["enum"]:
        errors.append(f"{path}: must be one of {', '.join(schema['enum'])}")
    kind = schema.get("type")
    if kind == "object":
        if not isinstance(value, dict):
            return [f"{path}: must be an object"]
        errors += [f"{path}.{k}: is required" for k in schema.get("required", []) if k not in value]
        for key, sub in schema.get("properties", {}).items():
            if key in value:
                errors += validate(value[key], sub, f"{path}.{key}")
    elif kind == "string":
        if not isinstance(value, str):
            errors.append(f"{path}: must be a string")
        elif len(value) > schema.get("maxLength", 10**9):
            errors.append(f"{path}: too long")
    elif kind == "integer":
        if not isinstance(value, int) or isinstance(value, bool):
            errors.append(f"{path}: must be an integer")
        else:
            if value < schema.get("minimum", -(10**18)):
                errors.append(f"{path}: below minimum")
            if value > schema.get("maximum", 10**18):
                errors.append(f"{path}: above maximum")
    return errors


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


@dataclass
class MockApi:
    videos: dict[str, dict[str, Any]] = field(default_factory=dict)
    rubrics: dict[str, list[dict[str, Any]]] = field(default_factory=dict)
    gets: dict[str, int] = field(default_factory=dict)
    uploads: dict[str, bytes] = field(default_factory=dict)
    requests: list[tuple[str, httpx.Request, Any]] = field(default_factory=list)
    faults: list[tuple[int, dict[str, str]]] = field(default_factory=list)
    decide_after_gets: int = 1
    counter: int = 0

    def fail_next(self, count: int, status: int, headers: dict[str, str] | None = None) -> None:
        self.faults += [(status, headers or {})] * count

    def calls(self, operation_id: str) -> list[httpx.Request]:
        return [r for op, r, _ in self.requests if op == operation_id]

    def sync_transport(self) -> httpx.MockTransport:
        def handler(request: httpx.Request) -> httpx.Response:
            request.read()
            return self.handle(request)

        return httpx.MockTransport(handler)

    def async_transport(self) -> httpx.MockTransport:
        async def handler(request: httpx.Request) -> httpx.Response:
            await request.aread()
            return self.handle(request)

        return httpx.MockTransport(handler)

    # ------------------------------------------------------------------ handling
    def handle(self, request: httpx.Request) -> httpx.Response:
        def error(status: int, code: str, message: str, **extra: Any) -> httpx.Response:
            return httpx.Response(status, json={"error": {"code": code, "message": message, **extra}})

        path = request.url.path.removeprefix("/api/v1")
        upload = re.match(r"^/__upload/(.+)$", path)
        if upload and request.method == "PUT":
            self.uploads[upload.group(1)] = request.content
            self.requests.append(("__upload", request, None))
            return httpx.Response(200)

        op = next((o for o in OPERATIONS if o.method == request.method and o.pattern.match(path)), None)
        if op is None:
            return error(404, "not_found", f"No route for {request.method} {path}")
        if request.headers.get("authorization") != f"Bearer {API_KEY}":
            return error(401, "unauthorized", "Invalid API key")
        body: Any = json.loads(request.content) if request.content else {}
        self.requests.append((op.id, request, body))
        if self.faults:
            status, headers = self.faults.pop(0)
            return httpx.Response(
                status, headers=headers, json={"error": {"code": "injected", "message": "Injected"}}
            )
        if op.body_schema is not None:
            problems = validate(body, op.body_schema)
            if problems:
                return error(400, "validation_error", problems[0], fields=problems)

        match = op.pattern.match(path)
        assert match is not None
        rid = match.group(1) if match.groups() else ""
        query = request.url.params

        def ok(payload: Any) -> httpx.Response:
            return httpx.Response(op.success_status, json=payload)

        if op.id == "createVideo":
            self.counter += 1
            vid = f"vid_{self.counter}"
            video = {
                "id": vid, "external_id": body.get("external_id"), "status": "awaiting_upload",
                "rubric_id": body["rubric_id"], "rubric_version": body.get("rubric_version", 1),
                "decision": None, "review": None, "lab_outcome": body.get("lab_outcome"),
                "created_at": _now(),
            }
            self.videos[vid] = video
            return ok({"video": video, "upload_url": f"{BASE}/__upload/{vid}",
                       "upload_expires_at": _now()})
        if op.id in {"completeUpload", "getVideo", "reviewVideo", "setLabOutcome"}:
            found_video = self.videos.get(rid)
            if found_video is None:
                return error(404, "not_found", "Video not found")
            video = found_video
            if op.id == "completeUpload":
                if video["status"] != "awaiting_upload":
                    return error(409, "conflict", "Already completed")
                video["status"] = "queued"
            elif op.id == "getVideo" and video["status"] in {"queued", "processing"}:
                self.gets[rid] = self.gets.get(rid, 0) + 1
                if self.gets[rid] > self.decide_after_gets:
                    video["status"] = "decided"
                    video["decision"] = {
                        "video_id": rid, "decision": "accept", "reasons": [], "checks": {},
                        "rubric": {"id": video["rubric_id"], "version": video["rubric_version"]},
                        "engine_version": "test",
                    }
                else:
                    video["status"] = "processing"
            elif op.id == "reviewVideo":
                video["review"] = {**body, "reviewed_at": _now()}
            elif op.id == "setLabOutcome":
                video["lab_outcome"] = body
            return ok(video)
        if op.id == "listVideos":
            everything = list(reversed(self.videos.values()))
            limit, start = int(query.get("limit", 50)), int(query.get("cursor", 0))
            nxt = str(start + limit) if start + limit < len(everything) else None
            return ok({"data": everything[start : start + limit], "next_cursor": nxt})
        if op.id == "createRubric":
            self.counter += 1
            rubric = {"id": f"rub_{self.counter}", "version": 1, **body}
            self.rubrics[rubric["id"]] = [rubric]
            return ok(rubric)
        if op.id == "listRubrics":
            return ok({"data": [versions[-1] for versions in self.rubrics.values()]})
        versions = self.rubrics.get(rid)
        if versions is None:
            return error(404, "not_found", "Rubric not found")
        if op.id == "getRubric":
            wanted = query.get("version")
            found = next((r for r in versions if wanted is None or r["version"] == int(wanted)), None)
            return ok(versions[-1] if wanted is None else found)
        if op.id == "updateRubric":
            nxt_rubric = {"id": rid, "version": len(versions) + 1, **body}
            versions.append(nxt_rubric)
            return ok(nxt_rubric)
        return error(500, "unhandled", op.id)
