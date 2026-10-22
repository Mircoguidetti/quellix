"""Technical quality: metadata, blur and exposure. Measurements only."""

from __future__ import annotations

import cv2
import numpy as np

from ..media import DecodedVideo
from ..rubric import CheckOutput
from .segments import flagged_runs

MODEL = "technical@0.1.0"

# Variance of the Laplacian of the grayscale frame, computed on the downscaled sample
# (longest side 480 px). Below this the frame counts as blurry. 60 is a common starting
# point for 480 px frames; calibrate against labelled data in `eval`.
BLUR_LAPLACIAN_VAR = 60.0

# A frame has bad exposure when its mean luma (0-255) is below DARK_MEAN or above
# BRIGHT_MEAN, or when more than CLIPPED_SHARE of its pixels are crushed (<= 8)
# or blown out (>= 247).
DARK_MEAN = 40.0
BRIGHT_MEAN = 215.0
CLIPPED_SHARE = 0.6


def is_blurry(gray: np.ndarray) -> bool:
    return float(cv2.Laplacian(gray, cv2.CV_64F).var()) < BLUR_LAPLACIAN_VAR


def is_badly_exposed(gray: np.ndarray) -> bool:
    mean = float(gray.mean())
    if mean < DARK_MEAN or mean > BRIGHT_MEAN:
        return True
    hist = cv2.calcHist([gray], [0], None, [256], [0, 256]).ravel() / gray.size
    return float(hist[:9].sum()) > CLIPPED_SHARE or float(hist[247:].sum()) > CLIPPED_SHARE


def run(video: DecodedVideo) -> CheckOutput:
    info = video.info
    if not info.decodable:
        return CheckOutput(measurements={"decodable": False}, model=MODEL)
    grays = [cv2.cvtColor(f.rgb, cv2.COLOR_RGB2GRAY) for f in video.frames]
    n = len(grays)
    times = [f.t_s for f in video.frames]
    step = 1.0 / video.sample_fps
    blurry = [is_blurry(g) for g in grays]
    bad_exposure = [is_badly_exposed(g) for g in grays]
    return CheckOutput(
        measurements={
            "decodable": True,
            "duration_s": info.duration_s,
            "width": info.width,
            "height": info.height,
            "fps": info.fps,
            "blur_ratio": sum(blurry) / n,
            "bad_exposure_ratio": sum(bad_exposure) / n,
            # where it happens, for the contributor-facing segments
            "blur_segments": flagged_runs(times, blurry, step),
            "bad_exposure_segments": flagged_runs(times, bad_exposure, step),
        },
        model=MODEL,
    )
