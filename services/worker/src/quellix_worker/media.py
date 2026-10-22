"""Decoding and frame sampling (PyAV). Decode once, share the frames between checks."""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path

import av
import cv2
import numpy as np

# 4 fps: fine enough for a 1.25x speed change to still line up with an indexed frame, and for a
# face or document to be in view in some sampled frame.
DEFAULT_SAMPLE_FPS = 4.0
# Frame pairs for camera-stability: each sampled frame is paired with the first frame at least
# this much later, shrunk to MOTION_WIDTH px (grayscale).
# Fingerprint frames: a denser, much smaller sample (PDQ works on 64x64 anyway), so a copy that
# was sped up or trimmed still finds an indexed frame less than ~30 ms away in time.
FINGERPRINT_FPS = 16.0
FINGERPRINT_MAX_SIDE = 96
MOTION_PAIR_GAP_S = 0.1
MOTION_WIDTH = 160
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
    # (gray_t, gray_t+gap) uint8 pairs, MOTION_WIDTH px wide, for the framing check
    motion_pairs: list[tuple[np.ndarray, np.ndarray]] = field(default_factory=list)
    fp_frames: list[Frame] = field(default_factory=list)


def _small_gray(rgb: np.ndarray) -> np.ndarray:
    h, w = rgb.shape[:2]
    scale = MOTION_WIDTH / w
    small = cv2.resize(rgb, (MOTION_WIDTH, max(1, round(h * scale))), interpolation=cv2.INTER_AREA)
    return cv2.cvtColor(small, cv2.COLOR_RGB2GRAY)


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
            pairs: list[tuple[np.ndarray, np.ndarray]] = []
            fp_frames: list[Frame] = []
            pending: tuple[float, np.ndarray] | None = None
            next_i = 0  # sampling is on a fixed grid (k / fps), so two videos line up
            next_fp = 0
            last_t = 0.0
            for frame in container.decode(stream):
                if frame.pts is None:
                    continue
                t = float(frame.pts * stream.time_base)
                last_t = max(last_t, t)
                wants_pair = pending is not None and t >= pending[0] + MOTION_PAIR_GAP_S
                wants_sample = t + 1e-6 >= next_i / sample_fps
                wants_fp = t + 1e-6 >= next_fp / FINGERPRINT_FPS
                if not (wants_pair or wants_sample or wants_fp):
                    continue
                full = frame.to_ndarray(format="rgb24")
                rgb = _downscale(full, max_side)
                if wants_fp:
                    fp_frames.append(Frame(t, _downscale(full, FINGERPRINT_MAX_SIDE)))
                    next_fp = max(next_fp + 1, int(t * FINGERPRINT_FPS + 1e-6) + 1)
                if wants_pair:
                    pairs.append((pending[1], _small_gray(rgb)))
                    pending = None
                if wants_sample:
                    frames.append(Frame(t, rgb))
                    pending = (t, _small_gray(rgb))
                    next_i = max(next_i + 1, int(t * sample_fps + 1e-6) + 1)
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
    return DecodedVideo(path, info, frames, sample_fps, pairs, fp_frames)
