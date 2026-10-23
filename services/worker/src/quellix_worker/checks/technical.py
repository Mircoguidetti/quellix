"""Technical quality: metadata, blur and exposure. Measurements only."""

from __future__ import annotations

import cv2
import numpy as np

from ..media import DecodedVideo
from ..rubric import CheckOutput
from .segments import flagged_runs

MODEL = "technical@0.2.0"

# Blur (#22). The old rule (variance of the Laplacian of the whole frame < 60) read a large plain
# area as blur: a sharp top-down shot of hands over a white worktop scored "blurry". Sharpness is
# now measured only where there is something to be sharp, and in every direction:
# - the 480 px grayscale frame is cut into tiles of about TILE_PX; a tile is *textured* when its
#   contrast (standard deviation of luma) is at least TEXTURE_STD; plain tiles are ignored;
# - per tile, the mean squared second derivative in 4 directions (horizontal, vertical, both
#   diagonals): motion blur removes detail along the motion, defocus in every direction;
# - per direction, the mean over the sharpest TOP_SHARE of the textured tiles (where the hands
#   and the work are), and the frame's sharpness is the weakest direction;
# - a dim frame is brightened first (gain up to MAX_GAIN, so its 99th percentile reaches
#   GAIN_TARGET): exposure is judged by its own rule, not by the blur one.
# A frame is blurry when its sharpness is below BLUR_SHARPNESS. A frame with no textured tile
# cannot be judged and never counts as blurry (a doubtful case must not reject).
# Calibrated on images that are not scored anywhere (scikit-image sample photos, whole and pasted
# on plain light and dark backgrounds, JPEG-compressed, with synthetic motion blur and defocus):
# sharp frames >= 52, 19 px motion blur / Gaussian defocus sigma 3 <= 28. At 30 a
# frame is blurry from about 8 px of motion blur or a defocus sigma of about 1.4 (medians).
TILE_PX = 60
TEXTURE_STD = 8.0
TOP_SHARE = 0.25
GAIN_TARGET = 200.0
MAX_GAIN = 3.0
BLUR_SHARPNESS = 30.0

_DIRECTIONS = (
    np.array([[1, -2, 1]], np.float32),
    np.array([[1], [-2], [1]], np.float32),
    np.array([[1, 0, 0], [0, -2, 0], [0, 0, 1]], np.float32),
    np.array([[0, 0, 1], [0, -2, 0], [1, 0, 0]], np.float32),
)

# A frame has bad exposure when its mean luma (0-255) is below DARK_MEAN or above
# BRIGHT_MEAN, or when more than CLIPPED_SHARE of its pixels are crushed (<= 8)
# or blown out (>= 247).
DARK_MEAN = 40.0
BRIGHT_MEAN = 215.0
CLIPPED_SHARE = 0.6


def sharpness(gray: np.ndarray) -> float | None:
    """Sharpness of a grayscale frame (see above), or None when no tile has texture."""
    g = gray.astype(np.float32)
    p99 = float(np.percentile(g, 99))
    g *= min(MAX_GAIN, max(1.0, GAIN_TARGET / max(p99, 1.0)))
    h, w = g.shape
    grid = (max(1, round(w / TILE_PX)), max(1, round(h / TILE_PX)))  # (cols, rows)

    def tile_mean(a: np.ndarray) -> np.ndarray:
        return cv2.resize(a, grid, interpolation=cv2.INTER_AREA).ravel()

    mean = tile_mean(g)
    std = np.sqrt(np.maximum(tile_mean(g * g) - mean * mean, 0.0))
    textured = std >= TEXTURE_STD
    n = int(textured.sum())
    if n == 0:
        return None
    k = max(1, int(np.ceil(n * TOP_SHARE)))
    per_direction = []
    for kernel in _DIRECTIONS:
        energy = tile_mean(cv2.filter2D(g, -1, kernel, borderType=cv2.BORDER_REFLECT) ** 2)
        per_direction.append(float(np.sort(energy[textured])[-k:].mean()))
    return min(per_direction)


def is_blurry(gray: np.ndarray) -> bool:
    s = sharpness(gray)
    return s is not None and s < BLUR_SHARPNESS


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
    sharp = [sharpness(g) for g in grays]
    blurry = [s is not None and s < BLUR_SHARPNESS for s in sharp]
    measured = sorted(s for s in sharp if s is not None)
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
            # frames with no texture at all (a wall, a blank worktop): blur cannot be judged
            "blur_unmeasurable_ratio": (n - len(measured)) / n,
            "sharpness_median": round(measured[len(measured) // 2], 1) if measured else None,
            # where it happens, for the contributor-facing segments
            "blur_segments": flagged_runs(times, blurry, step),
            "bad_exposure_segments": flagged_runs(times, bad_exposure, step),
        },
        model=MODEL,
    )
