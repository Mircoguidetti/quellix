"""Decoding and frame sampling (PyAV). Decode once, share the frames between checks."""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path

import av
import cv2
import numpy as np

DEFAULT_SAMPLE_FPS = 2.0
DEFAULT_MAX_SIDE = 480  # frames are downscaled so the longest side is at most this


@dataclass(frozen=True)
class VideoInfo:
    decodable: bool
    duration_s: float | None = None
    width: int | None = None
    height: int | None = None
    fps: float | None = None


@dataclass(frozen=True)
class Frame:
    t_s: float
    rgb: np.ndarray  # uint8, H x W x 3, downscaled


@dataclass
class DecodedVideo:
    path: Path
    info: VideoInfo
    frames: list[Frame] = field(default_factory=list)
    sample_fps: float = DEFAULT_SAMPLE_FPS


def _downscale(rgb: np.ndarray, max_side: int) -> np.ndarray:
    h, w = rgb.shape[:2]
    scale = max_side / max(h, w)
    if scale >= 1.0:
        return rgb
    return cv2.resize(rgb, (round(w * scale), round(h * scale)), interpolation=cv2.INTER_AREA)


def decode(
    path: str | Path,
    sample_fps: float = DEFAULT_SAMPLE_FPS,
    max_side: int = DEFAULT_MAX_SIDE,
) -> DecodedVideo:
    """Read metadata and sample frames. An unreadable file gives ``decodable=False``."""
    path = Path(path)
    if sample_fps <= 0:
        raise ValueError("sample_fps must be positive")
    try:
        with av.open(str(path)) as container:
            stream = container.streams.video[0]
            stream.thread_type = "AUTO"
            fps = float(stream.average_rate) if stream.average_rate else None
            width, height = stream.codec_context.width, stream.codec_context.height
            frames: list[Frame] = []
            next_t = 0.0
            last_t = 0.0
            for frame in container.decode(stream):
                if frame.pts is None:
                    continue
                t = float(frame.pts * stream.time_base)
                last_t = max(last_t, t)
                if t + 1e-6 >= next_t:
                    rgb = frame.to_ndarray(format="rgb24")
                    frames.append(Frame(t, _downscale(rgb, max_side)))
                    next_t = t + 1.0 / sample_fps
            if container.duration:
                duration = container.duration / av.time_base
            elif stream.duration:
                duration = float(stream.duration * stream.time_base)
            else:
                duration = last_t + (1.0 / fps if fps else 0.0)
    except (av.error.FFmpegError, IndexError, OSError, ValueError):
        return DecodedVideo(path, VideoInfo(decodable=False), [], sample_fps)
    if not frames:
        return DecodedVideo(path, VideoInfo(decodable=False), [], sample_fps)
    info = VideoInfo(True, round(duration, 3), width, height, fps)
    return DecodedVideo(path, info, frames, sample_fps)
