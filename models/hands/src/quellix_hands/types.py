"""Plain data types shared by inference, contact estimation and aggregation."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal

import numpy as np

Side = Literal["left", "right"]
SIDES: tuple[Side, Side] = ("left", "right")

# full: wrist to fingertips inside the frame (minus the margin); truncated: detected but cut by
# (or extending past) the frame edge; absent: not detected with enough confidence.
HandState = Literal["full", "truncated", "absent"]

# 100DOH contact taxonomy (Shan et al. 2020), plus "object" for "in contact with something, type
# unknown" (what the v0 heuristic can tell) and "unknown" when the hand is absent.
ContactState = Literal[
    "none", "self", "other_person", "portable_object", "stationary_object", "object", "unknown"
]
IN_CONTACT: frozenset[str] = frozenset({"portable_object", "stationary_object", "object"})


@dataclass(frozen=True)
class RawHand:
    """One detection from a detector, before truncation logic.

    Coordinates are normalized to the frame: x in [0, 1] left to right, y in [0, 1] top to
    bottom. Keypoints may lie outside [0, 1] when the detector extrapolates past the edge.
    """

    side: Side
    score: float
    keypoints: np.ndarray | None = None  # (21, 2), MediaPipe order: 0 wrist, 4/8/12/16/20 tips
    box: tuple[float, float, float, float] | None = None  # x0, y0, x1, y1


@dataclass(frozen=True)
class HandObservation:
    side: Side
    state: HandState
    confidence: float = 0.0
    keypoints: np.ndarray | None = None
    box: tuple[float, float, float, float] | None = None

    @property
    def present(self) -> bool:
        return self.state != "absent"

    @property
    def full(self) -> bool:
        return self.state == "full"


@dataclass(frozen=True)
class FrameHands:
    t_s: float
    left: HandObservation
    right: HandObservation
    contact: dict[Side, ContactState] = field(default_factory=dict)

    def hand(self, side: Side) -> HandObservation:
        return self.left if side == "left" else self.right


def absent(side: Side) -> HandObservation:
    return HandObservation(side=side, state="absent")
