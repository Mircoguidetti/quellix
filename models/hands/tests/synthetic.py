"""Synthetic hands for tests: 21-keypoint skeletons and coloured blobs drawn on frames."""

from __future__ import annotations

import numpy as np

from quellix_hands.types import RawHand, Side

# Blob colours a ColorBlobDetector reads back: the wearer's left hand red, right hand blue.
COLOURS: dict[Side, tuple[int, int, int]] = {"left": (255, 0, 0), "right": (0, 0, 255)}


def hand_keypoints(cx: float, cy: float, size: float = 0.1, *, closed: bool = False) -> np.ndarray:
    """MediaPipe-ordered 21 keypoints (normalized). Wrist below the palm, fingers pointing up.

    Open hand: tip-wrist ~ 1.9x MCP-wrist. Closed: tips folded back to ~1.1x.
    """
    kp = np.zeros((21, 2))
    wrist = np.array([cx, cy + size * 0.5])
    kp[0] = wrist
    angles = np.deg2rad([-60, -20, -5, 10, 25])  # thumb, index, middle, ring, pinky
    for f, a in enumerate(angles):
        direction = np.array([np.sin(a), -np.cos(a)])
        mcp = wrist + direction * size * 0.5
        reach = 1.1 if closed else 1.9
        for j in range(4):  # mcp, pip, dip, tip
            frac = 1.0 + (reach - 1.0) * (j / 3)
            kp[1 + f * 4 + j] = wrist + direction * size * 0.5 * frac
        kp[1 + f * 4] = mcp
    return kp


class ScriptedDetector:
    """Returns pre-set detections, one list per call, in order."""

    name = "scripted@test"

    def __init__(self, script: list[list[RawHand]]) -> None:
        self.script = list(script)
        self.calls = 0

    def detect(self, rgb: np.ndarray) -> list[RawHand]:
        out = self.script[self.calls]
        self.calls += 1
        return out


class ColorBlobDetector:
    """Finds the red / blue blobs drawn by ``draw_frame`` and returns their boxes. Box-only, so
    truncation is decided from where the drawn shape meets the frame edge."""

    name = "colorblob@test"

    def detect(self, rgb: np.ndarray) -> list[RawHand]:
        h, w = rgb.shape[:2]
        out: list[RawHand] = []
        for side, colour in COLOURS.items():
            mask = np.all(np.abs(rgb.astype(int) - np.array(colour)) < 60, axis=-1)
            if mask.sum() < 4:
                continue
            ys, xs = np.nonzero(mask)
            box = (xs.min() / w, ys.min() / h, (xs.max() + 1) / w, (ys.max() + 1) / h)
            out.append(RawHand(side, 0.9, None, box))
        return out


def draw_frame(blobs: dict[Side, tuple[float, float, float, float]],
               size: tuple[int, int] = (120, 160)) -> np.ndarray:
    """Grey frame with filled rectangles; boxes are normalized (x0, y0, x1, y1) and may extend
    past the frame, which simply clips them (a hand pushed out of frame)."""
    h, w = size
    img = np.full((h, w, 3), 128, dtype=np.uint8)
    for side, (x0, y0, x1, y1) in blobs.items():
        xa, xb = max(0, int(x0 * w)), min(w, int(x1 * w))
        ya, yb = max(0, int(y0 * h)), min(h, int(y1 * h))
        if xb > xa and yb > ya:
            img[ya:yb, xa:xb] = COLOURS[side]
    return img
