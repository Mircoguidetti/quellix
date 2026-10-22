"""Is a detected hand fully visible or cut by the frame edge?

A hand is ``truncated`` when any keypoint (or, for box-only detectors, any box edge) lies within
``margin`` of the frame border or outside it. ``margin`` is a fraction of the frame width (x) and
height (y). MediaPipe extrapolates keypoints past the edge, so a hand whose fingertips leave the
frame gets keypoints with x < 0 or > 1 and is caught here.

Default 0.02: at 640 px wide that is ~13 px, about a fingertip. Raise it to be stricter
("wrist to fingertips with some room"), lower it to be more lenient.
"""

from __future__ import annotations

import numpy as np

from .types import HandState

DEFAULT_MARGIN = 0.02


def state_from_keypoints(keypoints: np.ndarray, margin: float = DEFAULT_MARGIN) -> HandState:
    kp = np.asarray(keypoints, dtype=float)
    if kp.ndim != 2 or kp.shape[1] < 2 or len(kp) == 0:
        raise ValueError(f"keypoints must be (N, 2), got {kp.shape}")
    xy = kp[:, :2]
    inside = (xy >= margin) & (xy <= 1.0 - margin)
    return "full" if bool(inside.all()) else "truncated"


def state_from_box(
    box: tuple[float, float, float, float], margin: float = DEFAULT_MARGIN
) -> HandState:
    x0, y0, x1, y1 = box
    inside = x0 >= margin and y0 >= margin and x1 <= 1.0 - margin and y1 <= 1.0 - margin
    return "full" if inside else "truncated"
