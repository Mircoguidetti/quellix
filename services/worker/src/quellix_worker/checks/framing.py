"""Framing: camera stability and (heuristically) whether the camera points at the work."""

from __future__ import annotations

import cv2
import numpy as np

from ..jsonable import to_py
from ..media import MOTION_PAIR_GAP_S, DecodedVideo
from ..rubric import CheckOutput
from .segments import flagged_runs

MODEL = "framing@0.2.0"

# Stability: phase correlation between two frames MOTION_PAIR_GAP_S (0.1 s) apart gives the
# global shift. A pair is unstable when the camera moved more than this share of the frame
# width in that time (0.08 per 0.1 s = 0.8 frame widths per second, a whip pan or a shake),
# which ordinary head turns while working do not reach. Frames 0.5 s apart do not work: in a
# moving scene they stop correlating at all, which is not instability. A pair whose
# correlation peak is too weak to measure a shift is skipped, not counted.
UNSTABLE_SHIFT_SHARE = 0.08
MIN_RESPONSE = 0.02

# HEURISTIC, to be replaced by a model: a frame is "off target" when it has almost no
# structure, as when the camera looks at a blank wall, the ceiling, the floor or is covered:
# its grayscale standard deviation is below FLAT_STD AND its share of strong gradient pixels
# (Sobel magnitude over EDGE_MAGNITUDE) is below MIN_EDGE_SHARE. Dim or low-contrast but
# textured footage is not flagged. It does not know what the task is.
FLAT_STD = 12.0
EDGE_MAGNITUDE = 40.0
MIN_EDGE_SHARE = 0.01


def unstable_flags(pairs: list[tuple[np.ndarray, np.ndarray]]) -> list[bool | None]:
    """Per frame pair: True unstable, False stable, None not measurable (weak correlation)."""
    flags: list[bool | None] = []
    for a, b in pairs:
        window = cv2.createHanningWindow(a.shape[::-1], cv2.CV_32F)
        (dx, dy), response = cv2.phaseCorrelate(a.astype(np.float32), b.astype(np.float32),
                                                window)
        if response < MIN_RESPONSE:
            flags.append(None)
            continue
        flags.append(bool(float(np.hypot(dx, dy)) > UNSTABLE_SHIFT_SHARE * a.shape[1]))
    return flags


def unstable_ratio(pairs: list[tuple[np.ndarray, np.ndarray]]) -> float:
    measured = [f for f in unstable_flags(pairs) if f is not None]
    return sum(measured) / len(measured) if measured else 0.0


def is_off_target(gray: np.ndarray) -> bool:
    if float(gray.std()) >= FLAT_STD:
        return False
    gx = cv2.Sobel(gray, cv2.CV_32F, 1, 0)
    gy = cv2.Sobel(gray, cv2.CV_32F, 0, 1)
    return float((np.hypot(gx, gy) > EDGE_MAGNITUDE).mean()) < MIN_EDGE_SHARE


def off_target_ratio(grays: list[np.ndarray]) -> float:
    return sum(is_off_target(g) for g in grays) / len(grays)


def run(video: DecodedVideo) -> CheckOutput:
    if not video.frames:
        return CheckOutput(error="no frames to analyse")
    grays = [cv2.cvtColor(f.rgb, cv2.COLOR_RGB2GRAY) for f in video.frames]
    flags = unstable_flags(video.motion_pairs)
    measured = [f for f in flags if f is not None]
    off = [is_off_target(g) for g in grays]
    return CheckOutput(
        measurements=to_py({
            "unstable_ratio": sum(measured) / len(measured) if measured else 0.0,
            "off_target_ratio": sum(off) / len(off),
            # where it happens, for the contributor-facing segments
            "unstable_segments": flagged_runs(
                video.motion_times, [bool(f) for f in flags], MOTION_PAIR_GAP_S),
            "off_target_segments": flagged_runs([f.t_s for f in video.frames], off,
                                                1.0 / video.sample_fps),
        }),
        model=MODEL,
    )
