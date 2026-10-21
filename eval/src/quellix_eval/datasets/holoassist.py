"""HoloAssist (CDLA-Permissive-2.0) -> manifest of completed / not-completed examples.

For each recorded session we know the annotated fine-grained actions with start/end times.
- "completed": the full clip -> truth accept, task_completed pass.
- "not completed": the clip cut before the end of an annotated action -> truth reject,
  task_completed fail. Cut point = `cut_fraction` of the way through the last action.

Annotations are read from the HoloAssist `data-annotation-trainval-v1_1.json` layout:
a list of sessions, each with `video_name` and `events` [{label, start, end, ...}].
The cutting itself (ffmpeg/PyAV) is injected so tests need no real video.
"""

from __future__ import annotations

import argparse
import json
from collections.abc import Callable
from pathlib import Path
from typing import Any

from .manifest import ClipRecord, TaskSpec, write_manifest

LICENSE = "cdla-permissive-2.0"
SOURCE = "holoassist"

# (src_video, dst_video, end_seconds) -> None
Cutter = Callable[[Path, Path, float], None]


def _pyav_cutter(src: Path, dst: Path, end_s: float) -> None:  # pragma: no cover
    from ..defects.generate import truncate_video

    truncate_video(src, dst, end_s)


def action_events(session: dict[str, Any]) -> list[dict[str, Any]]:
    evs = [
        e for e in session.get("events", [])
        if e.get("label") == "Fine grained action" and e.get("end", 0) > e.get("start", 0)
    ]
    return sorted(evs, key=lambda e: e["end"])


def build(
    annotations: Path,
    video_dir: Path,
    out: Path,
    cut_dir: Path,
    limit: int = 100,
    cut_fraction: float = 0.5,
    cutter: Cutter = _pyav_cutter,
) -> int:
    sessions = json.loads(annotations.read_text())
    records: list[ClipRecord] = []
    for s in sessions:
        if len(records) >= 2 * limit:
            break
        name = s["video_name"]
        src = video_dir / f"{name}.mp4"
        evs = action_events(s)
        if not evs or not src.exists():
            continue
        last = evs[-1]
        task = TaskSpec(
            description=s.get("taskType") or s.get("task", "HoloAssist task"),
            steps=[str(e.get("attributes", {}).get("Verb", e["label"])) for e in evs][:20],
            final_state="all annotated actions performed",
        )
        records.append(ClipRecord(
            clip_id=f"holo_{name}_full", source=SOURCE, license=LICENSE, path=str(src),
            task=task, truth="accept", checks={"task_completed": "pass"},
            duration_s=float(last["end"]),
        ))
        cut_at = last["start"] + cut_fraction * (last["end"] - last["start"])
        dst = cut_dir / f"{name}_cut.mp4"
        cut_dir.mkdir(parents=True, exist_ok=True)
        cutter(src, dst, cut_at)
        records.append(ClipRecord(
            clip_id=f"holo_{name}_cut", source=SOURCE, license=LICENSE, path=str(dst),
            task=task, truth="reject", checks={"task_completed": "fail"},
            duration_s=float(cut_at), notes="cut inside the last annotated action",
        ))
    return write_manifest(records, out)


def main(argv: list[str] | None = None) -> None:  # pragma: no cover
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--annotations", type=Path, required=True)
    ap.add_argument("--video-dir", type=Path, required=True)
    ap.add_argument("--out", type=Path, default=Path("data/holoassist.jsonl"))
    ap.add_argument("--cut-dir", type=Path, default=Path("data/holoassist_cut"))
    ap.add_argument("--limit", type=int, default=100)
    a = ap.parse_args(argv)
    print(f"wrote {build(a.annotations, a.video_dir, a.out, a.cut_dir, a.limit)} clips")


if __name__ == "__main__":  # pragma: no cover
    main()
