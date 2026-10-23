"""Labelled viewpoint clips and what is extracted from them (#79).

Every label comes from the source, never from Ormes:
- first-person: Egocentric-10K and HoloAssist (head-mounted cameras by construction) and the
  founder's first-person Pexels landing clips;
- third-person: the founder's third-person Pexels clips (`test_sets/third_person_pexels.jsonl`)
  and Pexels search results labelled by eye (contact sheets posted on #79 for veto), listed in
  `PEXELS_EXTRA` with who labelled them.

The split is fixed by a hash of the *group* (factory+worker, HoloAssist session, Pexels video), so
clips of one recording never sit on both sides. Thresholds are fitted on `dev` only.
"""

from __future__ import annotations

import hashlib
import json
from collections.abc import Iterable, Sequence
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any, Literal

import cv2
import numpy as np

Label = Literal["first_person", "third_person"]
HELD_OUT_SHARE = 0.4
# Landmarks kept per hand (MediaPipe order): wrist, thumb tip, index MCP + tip, middle MCP + tip,
# ring tip, pinky MCP + tip. Enough for direction, scale and where the forearm enters.
KEEP = (0, 4, 5, 8, 9, 12, 16, 17, 20)


def split_of(group: str) -> Literal["dev", "held_out"]:
    h = int(hashlib.sha256(group.encode()).hexdigest()[:8], 16) / 0xFFFFFFFF
    return "held_out" if h < HELD_OUT_SHARE else "dev"


@dataclass(frozen=True)
class PexelsLabel:
    pexels_id: int
    slug: str
    label: Label
    orientation: str = "landscape"
    labelled_by: str = "founder"
    note: str = ""


# The founder's picks (issue #60): first-person landing clips, third-person test set.
PEXELS_FOUNDER: tuple[PexelsLabel, ...] = (
    PexelsLabel(7204592, "person-washing-a-drinking-glass", "first_person"),
    PexelsLabel(7418650, "a-person-making-a-salad", "first_person"),
    PexelsLabel(37443407, "whipping-cream-with-electric-mixer-in-bowl", "first_person"),
    PexelsLabel(7658012, "putting-ground-coffee-in-a-filter", "first_person"),
    PexelsLabel(7308220, "a-woman-stacking-shirts", "third_person"),
    PexelsLabel(4520150, "man-putting-jeans-inside-the-box", "third_person"),
    PexelsLabel(11102752, "close-up-on-person-cooking-in-pot", "third_person"),
    PexelsLabel(5592524, "person-cleaning-countertop-with-a-tissue", "third_person"),
    PexelsLabel(4440711, "a-person-putting-clothes-on-the-washing-machine", "third_person"),
    PexelsLabel(7641501, "woman-washing-cups-in-the-sink", "third_person", "portrait"),
    PexelsLabel(9141844, "person-putting-folded-clothes-on-a-bag", "third_person", "portrait"),
)
# Pexels search results labelled by eye from their contact sheets (filled after the first
# extraction run; the sheets are posted on #79 so the coordinator can veto a label).
PEXELS_EXTRA: tuple[PexelsLabel, ...] = ()

# Pexels searches for more candidates (not labelled until someone looks at them).
SEARCHES = (
    "woman cooking in kitchen", "man cooking", "person folding clothes", "washing dishes",
    "chopping vegetables", "kneading dough", "ironing clothes", "person cleaning table",
    "pov cooking", "pov hands", "first person view hands", "pov washing dishes",
)


@dataclass
class HandFeat:
    side: str
    state: str
    score: float
    kp: list[list[float]]                       # KEEP landmarks, normalised (x, y)


@dataclass
class FrameFeat:
    t: float
    hands: list[HandFeat] = field(default_factory=list)
    faces: list[list[float]] = field(default_factory=list)   # x, y, w, h, score (normalised)


@dataclass
class ClipFeatures:
    clip_id: str
    source: str
    group: str
    label: Label | None
    split: str
    width: int | None = None
    height: int | None = None
    duration_s: float | None = None
    frames: list[FrameFeat] = field(default_factory=list)
    motion: list[list[float]] = field(default_factory=list)  # dx, dy (share of width), response
    note: str = ""
    error: str | None = None

    def to_json(self) -> str:
        return json.dumps(asdict(self), separators=(",", ":"))

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> ClipFeatures:
        frames = [FrameFeat(f["t"], [HandFeat(**h) for h in f["hands"]], f["faces"])
                  for f in d.get("frames", [])]
        return cls(**{**d, "frames": frames})


def load(path: Path) -> list[ClipFeatures]:
    import gzip

    opener = gzip.open if path.suffix == ".gz" else open
    with opener(path, "rt") as f:
        return [ClipFeatures.from_dict(json.loads(line)) for line in f if line.strip()]


def save(path: Path, clips: Iterable[ClipFeatures]) -> None:
    import gzip

    path.parent.mkdir(parents=True, exist_ok=True)
    opener = gzip.open if path.suffix == ".gz" else open
    with opener(path, "wt") as f:
        for c in clips:
            f.write(c.to_json() + "\n")


def motion_of(pairs: Sequence[tuple[np.ndarray, np.ndarray]]) -> list[list[float]]:
    """Global shift between the frames of each motion pair (phase correlation)."""
    out = []
    for a, b in pairs:
        window = cv2.createHanningWindow(a.shape[::-1], cv2.CV_32F)
        (dx, dy), resp = cv2.phaseCorrelate(a.astype(np.float32), b.astype(np.float32), window)
        out.append([round(dx / a.shape[1], 4), round(dy / a.shape[1], 4), round(resp, 3)])
    return out


def hand_feats(frame_hands: Any) -> list[HandFeat]:
    out = []
    for obs in (frame_hands.left, frame_hands.right):
        if obs.state == "absent" or obs.keypoints is None:
            continue
        kp = np.asarray(obs.keypoints, dtype=float)[list(KEEP)]
        out.append(HandFeat(obs.side, obs.state, round(float(obs.confidence), 3),
                            [[round(float(x), 3), round(float(y), 3)] for x, y in kp]))
    return out


# Pixabay clips labelled by eye from their contact sheets (#79). One JSON per line:
# {"clip_id", "label": "first_person" | "third_person" | "exclude", "labelled_by", "note",
#  "vetoed": bool}. Excluded and vetoed clips never count.
PIXABAY_LABELS = Path(__file__).resolve().parents[3] / "test_sets" / "viewpoint_pixabay.jsonl"


def apply_labels(clips: Sequence[ClipFeatures], path: Path = PIXABAY_LABELS) -> list[ClipFeatures]:
    """Clips with the hand labels applied; unlabelled, excluded or vetoed candidates dropped."""
    labels: dict[str, dict[str, Any]] = {}
    if path.exists():
        for line in path.read_text().splitlines():
            if line.strip():
                row = json.loads(line)
                labels[row["clip_id"]] = row
    out = []
    for c in clips:
        if not c.source.startswith("pixabay"):
            out.append(c)
            continue
        row = labels.get(c.clip_id)
        if row is None or row.get("vetoed") or row.get("label") not in ("first_person",
                                                                         "third_person"):
            continue
        c.label = row["label"]
        c.source = f"pixabay:{row.get('labelled_by', 'unknown')}"
        out.append(c)
    return out
