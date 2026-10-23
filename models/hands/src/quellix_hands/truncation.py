"""Is a detected hand fully visible or cut by the frame edge?

A hand is ``truncated`` when any keypoint (or, for box-only detectors, any box edge) lies within
``margin`` of the frame border or outside it. ``margin`` is a fraction of the frame width (x) and
height (y). MediaPipe extrapolates keypoints past the edge, so a hand whose fingertips leave the
frame gets keypoints with x < 0 or > 1 and is caught here.

Default 0.02: at 640 px wide that is ~13 px, about a fingertip. Raise it to be stricter
("wrist to fingertips with some room"), lower it to be more lenient.

The wrist has its own rule (``wrist_slack``). Specs ask for "wrist to fingertips", so the wrist
must be in the frame, but in first-person video the arm comes in from the border and the wrist
sits on the edge, often a little past it in MediaPipe's extrapolation (up to ~4% on the landing
clips) while the hand is plainly whole. v0 required the wrist inside the 2% margin like every
other landmark, which made clearly visible hands "truncated" (issue #4). Now the wrist may lie up
to ``wrist_slack`` (5% of the frame) past the edge; further out, the hand is cut. Fingertips and
knuckles keep the margin.
"""

from __future__ import annotations

import numpy as np

from .types import HandState

DEFAULT_MARGIN = 0.02
DEFAULT_WRIST_SLACK = 0.05
WRIST = 0  # MediaPipe order


def state_from_keypoints(
    keypoints: np.ndarray, margin: float = DEFAULT_MARGIN, wrist_slack: float | None = None,
) -> HandState:
    """``wrist_slack=None`` is the v0 rule (every landmark, the wrist too, inside the margin);
    the model passes ``DEFAULT_WRIST_SLACK`` (see the module docstring)."""
    kp = np.asarray(keypoints, dtype=float)
    if kp.ndim != 2 or kp.shape[1] < 2 or len(kp) == 0:
        raise ValueError(f"keypoints must be (N, 2), got {kp.shape}")
    xy = kp[:, :2]
    if wrist_slack is not None and len(xy) > 1:
        wrist, xy = xy[WRIST], xy[1:]
        if not bool(((wrist >= -wrist_slack) & (wrist <= 1.0 + wrist_slack)).all()):
            return "truncated"
    inside = (xy >= margin) & (xy <= 1.0 - margin)
    return "full" if bool(inside.all()) else "truncated"


def state_from_box(
    box: tuple[float, float, float, float], margin: float = DEFAULT_MARGIN
) -> HandState:
    x0, y0, x1, y1 = box
    inside = x0 >= margin and y0 >= margin and x1 <= 1.0 - margin and y1 <= 1.0 - margin
    return "full" if inside else "truncated"
