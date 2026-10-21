"""Clip manifests: one JSON line per clip, never the videos themselves."""

from __future__ import annotations

from collections.abc import Iterable
from pathlib import Path
from typing import Literal

from pydantic import BaseModel, ConfigDict, field_validator

CheckLabel = Literal["pass", "fail", "unknown"]
LabelsSource = Literal["human", "synthetic", "baseline"]

# Datasets whose licenses forbid commercial use. Never allowed in a manifest.
FORBIDDEN_MARKERS = ("epic-kitchens", "epic_kitchens", "ego4d", "ego-exo4d", "egoexo4d")
ALLOWED_LICENSES = frozenset(
    {"apache-2.0", "cdla-permissive-2.0", "synthetic", "customer-opt-in", "cc0-1.0", "mit"}
)


class TaskSpec(BaseModel):
    model_config = ConfigDict(extra="forbid")

    description: str
    steps: list[str] = []
    final_state: str = ""


class ClipRecord(BaseModel):
    model_config = ConfigDict(extra="forbid")

    clip_id: str
    source: str
    license: str
    path: str
    task: TaskSpec
    truth: Literal["accept", "reject"]
    # Expected per-check label, e.g. {"hands_visible": "fail"}. Absent check = not asserted;
    # "unknown" = nobody knows (e.g. generated clips have no real hands): skipped in metrics.
    checks: dict[str, CheckLabel] = {}
    labels_source: LabelsSource = "human"
    duration_s: float | None = None
    notes: str = ""

    @field_validator("source", "license")
    @classmethod
    def _commercial_only(cls, v: str) -> str:
        low = v.lower()
        if any(m in low for m in FORBIDDEN_MARKERS):
            raise ValueError(f"non-commercial dataset not allowed: {v!r}")
        return v

    @field_validator("license")
    @classmethod
    def _known_license(cls, v: str) -> str:
        if v.lower() not in ALLOWED_LICENSES:
            raise ValueError(f"license {v!r} not in the commercial-use allowlist")
        return v


def write_manifest(records: Iterable[ClipRecord], path: str | Path) -> int:
    p = Path(path)
    p.parent.mkdir(parents=True, exist_ok=True)
    n = 0
    with p.open("w") as f:
        for r in records:
            f.write(r.model_dump_json() + "\n")
            n += 1
    return n


def load_manifest(path: str | Path) -> list[ClipRecord]:
    records: list[ClipRecord] = []
    seen: set[str] = set()
    for i, line in enumerate(Path(path).read_text().splitlines(), 1):
        if not line.strip():
            continue
        try:
            rec = ClipRecord.model_validate_json(line)
        except ValueError as e:
            raise ValueError(f"{path}:{i}: {e}") from e
        if rec.clip_id in seen:
            raise ValueError(f"{path}:{i}: duplicate clip_id {rec.clip_id!r}")
        seen.add(rec.clip_id)
        records.append(rec)
    return records
