"""Generate tiny synthetic clips at test time (no binary fixtures in git)."""

from __future__ import annotations

from fractions import Fraction
from pathlib import Path

import av
import cv2
import numpy as np


def scene(seed: int, n: int, size: tuple[int, int] = (160, 120)) -> list[np.ndarray]:
    """Textured, smoothly moving RGB frames. Different seeds give unrelated content."""
    rng = np.random.default_rng(seed)
    w, h = size
    base = cv2.resize(rng.integers(0, 256, (12, 16, 3), dtype=np.uint8), (w * 2, h * 2),
                      interpolation=cv2.INTER_CUBIC)
    blobs = [(rng.integers(10, w - 30), rng.integers(10, h - 30), rng.integers(0, 256, 3))
             for _ in range(5)]
    frames = []
    for i in range(n):
        ox, oy = int(i * 1.5) % w // 2, int(i) % h // 2
        f = base[oy:oy + h, ox:ox + w].copy()
        for k, (x, y, c) in enumerate(blobs):
            x0, y0 = int(x + 4 * np.sin(i / 7 + k)), int(y + 4 * np.cos(i / 9 + k))
            cv2.rectangle(f, (x0, y0), (x0 + 22, y0 + 22), tuple(int(v) for v in c), -1)
            cv2.circle(f, (x0 + 40 % w, y0), 8, (255 - int(c[0]), 200, 30), 2)
        frames.append(f)
    return frames


def write_clip(path: Path, frames: list[np.ndarray], fps: int = 10) -> Path:
    h, w = frames[0].shape[:2]
    with av.open(str(path), "w") as out:
        stream = out.add_stream("libx264", rate=Fraction(fps))
        stream.width, stream.height, stream.pix_fmt = w, h, "yuv420p"
        stream.options = {"crf": "18"}
        for fr in frames:
            for pkt in stream.encode(av.VideoFrame.from_ndarray(fr, format="rgb24")):
                out.mux(pkt)
        for pkt in stream.encode():
            out.mux(pkt)
    return path
