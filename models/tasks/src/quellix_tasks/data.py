"""Training / evaluation data: `eval` clip manifests (JSONL), with the license rules enforced.

Only commercially usable sources (HoloAssist CDLA-Permissive-2.0, Egocentric-10K Apache-2.0,
synthetic clips, opted-in customer data). Non-commercial datasets are refused outright.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any

FORBIDDEN_MARKERS = ("epic-kitchens", "epic_kitchens", "ego4d", "ego-exo4d", "egoexo4d")
ALLOWED_LICENSES = frozenset(
    {"apache-2.0", "cdla-permissive-2.0", "synthetic", "customer-opt-in", "cc0-1.0", "mit"}
)
# Licenses under which a clip may be sent to an external general model (teacher labels).
PUBLIC_LICENSES = frozenset({"apache-2.0", "cdla-permissive-2.0", "synthetic", "cc0-1.0", "mit"})


@dataclass(frozen=True)
class Clip:
    clip_id: str
    path: Path
    source: str
    license: str
    task: dict[str, Any]
    completed: bool | None      # truth for task_completed; None = not labelled
    labels_source: str
    group: str                  # clips of one recording share a group (never split apart)
    raw: dict[str, Any]


def _group(clip_id: str) -> str:
    for suffix in ("_full", "_cut"):
        if clip_id.endswith(suffix):
            return clip_id.removesuffix(suffix)
    return clip_id


def check_license(source: str, license_: str) -> None:
    low = f"{source} {license_}".lower()
    if any(m in low for m in FORBIDDEN_MARKERS):
        raise ValueError(f"non-commercial dataset not allowed: {source!r} / {license_!r}")
    if license_.lower() not in ALLOWED_LICENSES:
        raise ValueError(f"license {license_!r} not in the commercial-use allowlist")


def load_manifest(path: Path) -> list[Clip]:
    clips = []
    for n, line in enumerate(path.read_text().splitlines(), 1):
        if not line.strip():
            continue
        r = json.loads(line)
        try:
            check_license(r["source"], r["license"])
        except ValueError as exc:
            raise ValueError(f"{path}:{n}: {exc}") from None
        label = r.get("checks", {}).get("task_completed")
        completed = {"pass": True, "fail": False}.get(label)
        p = Path(r["path"])
        if not p.is_absolute():
            p = (path.parent / p).resolve()
        clips.append(Clip(r["clip_id"], p, r["source"], r["license"], r.get("task", {}),
                          completed, r.get("labels_source", "human"), _group(r["clip_id"]), r))
    return clips
