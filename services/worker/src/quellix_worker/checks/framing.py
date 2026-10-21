"""Framing: camera stability and (heuristically) whether the camera points at the work."""

from __future__ import annotations

import cv2
import numpy as np

from ..media import DecodedVideo
from ..rubric import CheckOutput

MODEL = "framing@0.1.0"

# Phase correlation between consecutive sampled frames gives the global shift. A pair is
# unstable when the shift exceeds this share of the frame width, or when the frames no
# longer correlate at all (response below MIN_RESPONSE: a violent jerk or a scene cut).
# Sampling is ~2 fps by default, so this catches large shake and whip pans, not fine jitter.
UNSTABLE_SHIFT_SHARE = 0.15
MIN_RESPONSE = 0.03

# HEURISTIC, to be replaced by a model: a frame is "off target" when it has almost no
# structure (share of Canny edge pixels below this), as when the camera looks at a blank
# wall, the ceiling or the floor. It does not know what the task is.
MIN_EDGE_DENSITY = 0.01


def unstable_ratio(grays: list[np.ndarray]) -> float:
    if len(grays) < 2:
        return 0.0
    unstable = 0
    for prev, cur in zip(grays, grays[1:], strict=False):
        window = cv2.createHanningWindow(prev.shape[::-1], cv2.CV_32F)
        (dx, dy), response = cv2.phaseCorrelate(
            prev.astype(np.float32), cur.astype(np.float32), window
        )
        if response < MIN_RESPONSE or np.hypot(dx, dy) > UNSTABLE_SHIFT_SHARE * prev.shape[1]:
            unstable += 1
    return unstable / (len(grays) - 1)


def off_target_ratio(grays: list[np.ndarray]) -> float:
    off = sum(float((cv2.Canny(g, 80, 160) > 0).mean()) < MIN_EDGE_DENSITY for g in grays)
    return off / len(grays)


def run(video: DecodedVideo) -> CheckOutput:
    if not video.frames:
        return CheckOutput(error="no frames to analyse")
    grays = [cv2.cvtColor(f.rgb, cv2.COLOR_RGB2GRAY) for f in video.frames]
    return CheckOutput(
        measurements={
            "unstable_ratio": unstable_ratio(grays),
            "off_target_ratio": off_target_ratio(grays),
        },
        model=MODEL,
    )
