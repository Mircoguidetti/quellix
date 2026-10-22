"""Cut a time window out of a video, resized and resampled like the rest of the eval."""

from __future__ import annotations

from fractions import Fraction
from pathlib import Path

import av
import cv2
import numpy as np


def cut(src: Path, dst: Path, start_s: float, end_s: float, width: int = 640,
        fps: float = 15.0) -> float:
    """Write [start_s, end_s) of src at most `width` px wide and ~`fps`. -> written seconds."""
    if end_s <= start_s:
        raise ValueError("empty window")
    dst.parent.mkdir(parents=True, exist_ok=True)
    written = 0
    with av.open(str(src)) as inp, av.open(str(dst), "w") as out:
        stream = inp.streams.video[0]
        stream.thread_type = "AUTO"
        src_fps = float(stream.average_rate or 30)
        step = max(1, round(src_fps / fps))
        if start_s > 1:
            inp.seek(int(max(0.0, start_s - 1) / stream.time_base), stream=stream, backward=True)
        ostream = None
        i = 0
        for frame in inp.decode(stream):
            t = float(frame.pts * stream.time_base) if frame.pts is not None else 0.0
            if t < start_s:
                continue
            if t >= end_s:
                break
            i += 1
            if (i - 1) % step:
                continue
            img = frame.to_ndarray(format="rgb24")
            h, w = img.shape[:2]
            new_w = min(width, w) - min(width, w) % 2
            new_h = int(h * new_w / w) - int(h * new_w / w) % 2
            img = cv2.resize(img, (new_w, new_h), interpolation=cv2.INTER_AREA)
            if ostream is None:
                rate = Fraction(src_fps / step).limit_denominator(1000)
                ostream = out.add_stream("mpeg4", rate=rate)
                ostream.width, ostream.height, ostream.pix_fmt = new_w, new_h, "yuv420p"
                ostream.options = {"qscale": "3"}
            vf = av.VideoFrame.from_ndarray(np.ascontiguousarray(img), format="rgb24")
            for p in ostream.encode(vf):
                out.mux(p)
            written += 1
        if ostream is not None:
            for p in ostream.encode():
                out.mux(p)
    if written == 0:
        raise ValueError(f"no frames in [{start_s}, {end_s}) of {src}")
    return written / (src_fps / step)
