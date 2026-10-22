"""What the worker's privacy check flags on the (assumed clean) original clips.

The Egocentric-10K originals are factory footage: they may really contain coworkers' faces or
machine screens. This turns the worker's privacy measurements into (a) a table by type and
detector score and (b) a contact sheet of the flagged frames, so a person can look at what is
being detected instead of guessing.

The worker writes the annotated frames when QUELLIX_DEBUG_FRAMES_DIR is set (files are named
``<clip_id>__<kind>__<t>.jpg``).
"""

from __future__ import annotations

import statistics
from collections import Counter
from collections.abc import Mapping, Sequence
from pathlib import Path
from typing import Any

import cv2
import numpy as np

from .datasets.manifest import ClipRecord
from .run import EngineResult

KINDS = ("faces", "documents", "screens")
BUCKETS = (("< 0.80", 0.0, 0.80), ("0.80-0.90", 0.80, 0.90), ("0.90-0.95", 0.90, 0.95),
           (">= 0.95", 0.95, 1.01))


def _bucket(score: float | None) -> str:
    if score is None:
        return "no score"
    return next(name for name, lo, hi in BUCKETS if lo <= score < hi) if score < 1.01 else ">= 0.95"


def _is_original(clip_id: str) -> bool:
    return "__" not in clip_id


def privacy_breakdown(results: Mapping[str, EngineResult],
                      clips: Sequence[ClipRecord]) -> str:
    """Markdown: flagged originals by type and score bucket, sizes, and examples."""
    originals = [c for c in clips if _is_original(c.clip_id)]
    flagged: dict[str, dict[str, list[dict[str, Any]]]] = {k: {} for k in KINDS}
    evaluated = 0
    for c in originals:
        res = results.get(c.clip_id)
        meas = ((res.decision or {}).get("checks", {}).get("privacy", {}).get("measurements")
                if res else None)
        if meas is None:
            continue
        evaluated += 1
        for kind in KINDS:
            if meas.get(kind):
                flagged[kind][c.clip_id] = meas[kind]

    lines = ["", "## Privacy detections on the original clips", "",
             f"{evaluated} originals had a privacy measurement. These clips are assumed clean, so "
             "every detection below is either a false alarm or genuinely sensitive footage "
             "(see the contact sheet `privacy_contact_sheet.jpg`).", ""]
    rows = []
    for kind in KINDS:
        by_clip = flagged[kind]
        dets = [d for ds in by_clip.values() for d in ds]
        buckets = Counter(_bucket(d.get("score")) for d in dets)
        widths = [d["box"][2] for d in dets if d.get("box")]
        rows.append([
            kind, str(len(by_clip)), str(len(dets)),
            ", ".join(f"{name}: {buckets.get(name, 0)}" for name, _, _ in BUCKETS)
            + (f", no score: {buckets['no score']}" if buckets.get("no score") else ""),
            f"{statistics.median(widths):.2f}" if widths else "n/a",
        ])
    lines += ["| type | clips flagged | detections | by score | median box width (of frame) |",
              "|---|---|---|---|---|"]
    lines += ["| " + " | ".join(r) + " |" for r in rows]
    examples = [f"- `{cid}` {kind}: first at {ds[0]['t_s']:.1f}s"
                for kind in KINDS for cid, ds in list(flagged[kind].items())[:5]]
    if examples:
        lines += ["", "First flagged clips per type:"] + examples
    return "\n".join(lines) + "\n"


def contact_sheet(frames_dir: Path, out_path: Path, max_frames: int = 48,
                  thumb: tuple[int, int] = (240, 135), cols: int = 6) -> int:
    """Tile the flagged original frames (annotated by the worker) into one JPEG. -> n tiles."""
    files = sorted(p for p in frames_dir.glob("*.jpg")
                   if len(p.stem.split("__")) == 3)[:max_frames]  # originals only
    if not files:
        return 0
    tiles = []
    for p in files:
        img = cv2.imread(str(p))
        if img is None:
            continue
        tile = cv2.resize(img, thumb)
        label = p.stem.split("__")
        cv2.putText(tile, f"{label[1]} {label[2]}s", (4, thumb[1] - 6),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.4, (255, 255, 255), 1)
        tiles.append(tile)
    blank = np.zeros_like(tiles[0])
    rows = [np.hstack(tiles[i:i + cols] + [blank] * (cols - len(tiles[i:i + cols])))
            for i in range(0, len(tiles), cols)]
    out_path.parent.mkdir(parents=True, exist_ok=True)
    cv2.imwrite(str(out_path), np.vstack(rows))
    return len(tiles)
