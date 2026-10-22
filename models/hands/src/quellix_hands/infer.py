"""Per-frame inference: detector output -> left/right hand observations with a state."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol

import numpy as np

from .truncation import DEFAULT_MARGIN, state_from_box, state_from_keypoints
from .types import FrameHands, HandObservation, RawHand, Side, absent


class Detector(Protocol):
    """Anything that finds hands in one RGB frame (uint8, H x W x 3).

    ``RawHand.side`` must already be the person's own left/right as seen from an egocentric,
    non-mirrored camera.
    """

    name: str

    def detect(self, rgb: np.ndarray) -> list[RawHand]: ...


@dataclass(frozen=True)
class InferConfig:
    margin: float = DEFAULT_MARGIN  # see truncation.py
    min_confidence: float = 0.5  # detections below this count as absent


def _bbox(keypoints: np.ndarray) -> tuple[float, float, float, float]:
    xy = np.asarray(keypoints, dtype=float)[:, :2]
    return (float(xy[:, 0].min()), float(xy[:, 1].min()),
            float(xy[:, 0].max()), float(xy[:, 1].max()))


def _center_x(h: RawHand) -> float:
    if h.keypoints is not None:
        return float(np.asarray(h.keypoints)[:, 0].mean())
    if h.box is not None:
        return (h.box[0] + h.box[2]) / 2
    return 0.5


def assign_sides(hands: list[RawHand]) -> dict[Side, RawHand]:
    """At most one hand per side. If the detector labels two hands with the same side, keep the
    labels of the more confident one and give the other the opposite side when it lies on that
    side of it in the image (egocentric: the left hand is usually left of the right hand)."""
    by_side: dict[Side, RawHand] = {}
    for h in sorted(hands, key=lambda h: h.score, reverse=True):
        if h.side not in by_side:
            by_side[h.side] = h
            continue
        other: Side = "right" if h.side == "left" else "left"
        kept = by_side[h.side]
        plausible = (_center_x(h) < _center_x(kept)) if other == "left" else (
            _center_x(h) > _center_x(kept))
        if other not in by_side and plausible:
            by_side[other] = RawHand(other, h.score, h.keypoints, h.box)
    return by_side


def observe(raw: RawHand | None, side: Side, cfg: InferConfig) -> HandObservation:
    if raw is None or raw.score < cfg.min_confidence:
        return absent(side)
    if raw.keypoints is not None:
        state = state_from_keypoints(raw.keypoints, cfg.margin)
        box = raw.box or _bbox(raw.keypoints)
    elif raw.box is not None:
        state = state_from_box(raw.box, cfg.margin)
        box = raw.box
    else:
        return absent(side)
    return HandObservation(side, state, float(raw.score), raw.keypoints, box)


def infer_frame(rgb: np.ndarray, t_s: float, detector: Detector,
                cfg: InferConfig | None = None) -> FrameHands:
    cfg = cfg or InferConfig()
    sides = assign_sides(detector.detect(rgb))
    return FrameHands(t_s=float(t_s), left=observe(sides.get("left"), "left", cfg),
                      right=observe(sides.get("right"), "right", cfg))
