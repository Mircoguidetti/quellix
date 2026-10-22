"""Synthetic defects: from a clean clip, labelled bad variants. Labels come for free.

Frames are uint8 RGB arrays (H, W, 3). Every transform is pure numpy/OpenCV; the
file-level helpers use PyAV. No third-party images: overlays are drawn here.
"""

from __future__ import annotations

from collections.abc import Callable, Sequence
from dataclasses import dataclass, field
from fractions import Fraction
from pathlib import Path

import av
import cv2
import numpy as np

Frames = list[np.ndarray]


@dataclass(frozen=True)
class Variant:
    """A defect recipe: how to change the clip and what the labels become."""

    name: str
    checks: dict[str, str]          # expected per-check labels, e.g. {"hands_visible": "fail"}
    truth: str                      # "accept" | "reject"
    why: str


@dataclass
class Clip:
    frames: Frames
    fps: float
    meta: dict = field(default_factory=dict)


# --- I/O ---------------------------------------------------------------------------------


def read_video(path: str | Path) -> Clip:
    frames: Frames = []
    with av.open(str(path)) as c:
        stream = c.streams.video[0]
        fps = float(stream.average_rate or 30)
        for fr in c.decode(stream):
            frames.append(fr.to_ndarray(format="rgb24"))
    return Clip(frames, fps)


def write_video(path: str | Path, frames: Sequence[np.ndarray], fps: float) -> None:
    if not frames:
        raise ValueError("no frames")
    h, w = frames[0].shape[:2]
    h, w = h - h % 2, w - w % 2
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    with av.open(str(path), "w") as c:
        s = c.add_stream("mpeg4", rate=Fraction(fps).limit_denominator(1000))
        s.width, s.height, s.pix_fmt = w, h, "yuv420p"
        s.options = {"qscale": "3"}
        for f in frames:
            vf = av.VideoFrame.from_ndarray(np.ascontiguousarray(f[:h, :w]), format="rgb24")
            for p in s.encode(vf):
                c.mux(p)
        for p in s.encode():
            c.mux(p)


def truncate_video(src: str | Path, dst: str | Path, end_s: float) -> None:
    clip = read_video(src)
    n = max(1, int(end_s * clip.fps))
    write_video(dst, clip.frames[:n], clip.fps)


# --- clean clip for tests and fixtures ---------------------------------------------------


def make_clean_clip(
    n_frames: int = 48, size: tuple[int, int] = (96, 128), fps: float = 24.0, seed: int = 0
) -> Clip:
    """A textured scene with two moving 'hand' blobs and an object that ends in a 'done' state."""
    rng = np.random.default_rng(seed)
    h, w = size
    base = rng.integers(70, 190, (h // 8, w // 8, 3), dtype=np.uint8)
    bg = cv2.resize(base, (w, h), interpolation=cv2.INTER_CUBIC)
    frames: Frames = []
    for i in range(n_frames):
        t = i / max(1, n_frames - 1)
        f = bg.copy()
        cx = int(w * (0.3 + 0.1 * np.sin(6 * t)))
        cv2.circle(f, (cx, int(h * 0.65)), h // 8, (224, 172, 105), -1)          # left hand
        cv2.circle(f, (w - cx, int(h * 0.65)), h // 8, (224, 172, 105), -1)      # right hand
        cv2.rectangle(f, (w // 2 - 10, int(h * (0.2 + 0.3 * t))),
                      (w // 2 + 10, int(h * (0.2 + 0.3 * t)) + 16), (40, 90, 200), -1)
        frames.append(f)
    return Clip(frames, fps, {"hand_center_x": [0.3, 0.7]})


# --- transforms --------------------------------------------------------------------------


def shift_hands_out(frames: Frames, side: str = "left", fraction: float = 0.45) -> Frames:
    """Push the content toward one edge so hands leave the frame (crop + resize to same size)."""
    h, w = frames[0].shape[:2]
    cut = int(w * fraction)
    out = []
    for f in frames:
        crop = f[:, cut:] if side == "left" else f[:, : w - cut]
        out.append(cv2.resize(crop, (w, h), interpolation=cv2.INTER_LINEAR))
    return out


# Hand defects: a crop/zoom applied to a known interval of the clip (HAND_INTERVAL, as
# fractions of its length); outside it the clip is unchanged. Crops keep the aspect ratio, so
# hands are neither stretched nor covered by black borders. Head-mounted footage shows the hands
# in the lower part of the frame, one on each side of the centre (as `make_clean_clip` does).
HAND_INTERVAL = (0.2, 0.8)


def interval_frames(n: int, interval: tuple[float, float] = HAND_INTERVAL) -> range:
    return range(int(round(n * interval[0])), int(round(n * interval[1])))


def _zoom(f: np.ndarray, x0: float, y0: float, scale: float) -> np.ndarray:
    """Crop a (scale*w, scale*h) window at (x0*w, y0*h) and resize it back to (w, h)."""
    h, w = f.shape[:2]
    cw, ch = int(round(w * scale)), int(round(h * scale))
    x, y = int(round(w * x0)), int(round(h * y0))
    return cv2.resize(f[y : y + ch, x : x + cw], (w, h), interpolation=cv2.INTER_LINEAR)


def _in_interval(frames: Frames, fn: Callable[[np.ndarray], np.ndarray],
                 interval: tuple[float, float] = HAND_INTERVAL) -> Frames:
    idx = set(interval_frames(len(frames), interval))
    return [fn(f) if i in idx else f for i, f in enumerate(frames)]


def hand_out_one(frames: Frames, interval: tuple[float, float] = HAND_INTERVAL) -> Frames:
    """Zoom on the bottom-right quarter: the left hand leaves through the left edge."""
    return _in_interval(frames, lambda f: _zoom(f, 0.5, 0.5, 0.5), interval)


def hands_out_both(frames: Frames, interval: tuple[float, float] = HAND_INTERVAL) -> Frames:
    """Zoom on the upper middle (top 50%): both hands leave through the bottom edge."""
    return _in_interval(frames, lambda f: _zoom(f, 0.25, 0.0, 0.5), interval)


def hand_truncated(frames: Frames, interval: tuple[float, float] = HAND_INTERVAL) -> Frames:
    """Zoom on the top 70%: the bottom edge cuts through the hands (seen, not fully visible)."""
    return _in_interval(frames, lambda f: _zoom(f, 0.15, 0.0, 0.7), interval)


def no_manipulation(frames: Frames) -> Frames:
    """The middle frame held for the whole clip: a static scene, nothing is manipulated."""
    return [frames[len(frames) // 2].copy() for _ in frames]


def cut_before_end(frames: Frames, keep: float = 0.5) -> Frames:
    return frames[: max(1, int(len(frames) * keep))]


def motion_blur(frames: Frames, ksize: int = 25) -> Frames:
    k = np.zeros((ksize, ksize), np.float32)
    k[ksize // 2, :] = 1.0 / ksize
    return [cv2.filter2D(f, -1, k) for f in frames]


def exposure(frames: Frames, gain: float) -> Frames:
    """gain < 1 under-exposes, gain > 1 over-exposes."""
    return [np.clip(f.astype(np.float32) * gain, 0, 255).astype(np.uint8) for f in frames]


def overlay_document(frames: Frames) -> Frames:
    out = []
    for f in frames:
        g = f.copy()
        h, w = g.shape[:2]
        x0, y0, x1, y1 = int(w * 0.55), int(h * 0.1), int(w * 0.95), int(h * 0.7)
        cv2.rectangle(g, (x0, y0), (x1, y1), (245, 245, 240), -1)
        for y in range(y0 + 6, y1 - 4, 8):
            cv2.line(g, (x0 + 4, y), (x1 - 4, y), (30, 30, 30), 1)
        out.append(g)
    return out


def overlay_face(frames: Frames) -> Frames:
    out = []
    for f in frames:
        g = f.copy()
        h, w = g.shape[:2]
        c, r = (int(w * 0.8), int(h * 0.3)), h // 5
        cv2.circle(g, c, r, (230, 190, 160), -1)
        for dx in (-r // 3, r // 3):
            cv2.circle(g, (c[0] + dx, c[1] - r // 5), max(1, r // 8), (20, 20, 20), -1)
        cv2.ellipse(g, (c[0], c[1] + r // 3), (r // 3, r // 6), 0, 0, 180, (120, 40, 40), 2)
        out.append(g)
    return out


def overlay_screen(frames: Frames) -> Frames:
    out = []
    for i, f in enumerate(frames):
        g = f.copy()
        h, w = g.shape[:2]
        x0, y0, x1, y1 = int(w * 0.05), int(h * 0.05), int(w * 0.45), int(h * 0.4)
        cv2.rectangle(g, (x0, y0), (x1, y1), (15, 15, 20), -1)
        cv2.rectangle(g, (x0, y0), (x1, y1), (180, 180, 180), 2)
        cv2.putText(g, "LOGIN", (x0 + 6, y0 + 18), cv2.FONT_HERSHEY_SIMPLEX, 0.45,
                    (80, 255, 120), 1)
        cv2.rectangle(g, (x0 + 6, y0 + 28 + (i % 3)), (x1 - 6, y0 + 40 + (i % 3)),
                      (60, 120, 255), -1)
        out.append(g)
    return out


def mirror(frames: Frames) -> Frames:
    return [f[:, ::-1].copy() for f in frames]


def crop_border(frames: Frames, fraction: float = 0.08) -> Frames:
    h, w = frames[0].shape[:2]
    dy, dx = int(h * fraction), int(w * fraction)
    return [cv2.resize(f[dy : h - dy, dx : w - dx], (w, h)) for f in frames]


def speed_change(frames: Frames, factor: float = 1.25) -> Frames:
    n = max(1, int(len(frames) / factor))
    idx = np.linspace(0, len(frames) - 1, n).round().astype(int)
    return [frames[i] for i in idx]


def trim(frames: Frames, head: float = 0.1, tail: float = 0.1) -> Frames:
    n = len(frames)
    return frames[int(n * head) : max(int(n * head) + 1, int(n * (1 - tail)))]


def re_encode(frames: Frames) -> Frames:
    """Identity on pixels; the re-encode happens when the variant is written to disk."""
    return list(frames)


_Fn = Callable[[Frames], Frames]

VARIANTS: dict[str, tuple[Variant, _Fn]] = {
    "hands_out": (
        Variant("hands_out", {"hands_visible": "fail"}, "reject",
                "content shifted so hands leave the frame"), shift_hands_out),
    "hand_out_one": (
        Variant("hand_out_one", {"hands_visible": "fail"}, "reject",
                "left hand pushed out of frame for the middle 60% of the clip"), hand_out_one),
    "hands_out_both": (
        Variant("hands_out_both", {"hands_visible": "fail"}, "reject",
                "both hands pushed out of frame for the middle 60% of the clip"), hands_out_both),
    "hand_truncated": (
        Variant("hand_truncated", {"hands_visible": "fail"}, "reject",
                "hands cut by the bottom edge for the middle 60% of the clip"), hand_truncated),
    "no_manipulation": (
        Variant("no_manipulation", {"hands_visible": "uncertain"}, "reject",
                "static scene (one frame held): no manipulation, must go to review"),
        no_manipulation),
    "truncated": (
        Variant("truncated", {"task_completed": "fail"}, "reject",
                "clip cut before the task ends"), cut_before_end),
    "blur": (
        Variant("blur", {"technical": "fail"}, "reject", "heavy horizontal motion blur"),
        motion_blur),
    "underexposed": (
        Variant("underexposed", {"technical": "fail"}, "reject", "frames far too dark"),
        lambda f: exposure(f, 0.12)),
    "overexposed": (
        Variant("overexposed", {"technical": "fail"}, "reject", "frames blown out"),
        lambda f: exposure(f, 4.0)),
    "document": (
        Variant("document", {"privacy": "fail"}, "reject", "readable document overlaid"),
        overlay_document),
    "face": (
        Variant("face", {"privacy": "fail"}, "reject", "face overlaid"), overlay_face),
    "screen": (
        Variant("screen", {"privacy": "fail"}, "reject", "screen overlaid"), overlay_screen),
    "dup_reencode": (
        Variant("dup_reencode", {"originality": "fail"}, "reject", "re-encoded duplicate"),
        re_encode),
    "dup_crop": (
        Variant("dup_crop", {"originality": "fail"}, "reject", "cropped duplicate"), crop_border),
    "dup_mirror": (
        Variant("dup_mirror", {"originality": "fail"}, "reject", "mirrored duplicate"), mirror),
    "dup_speed": (
        Variant("dup_speed", {"originality": "fail"}, "reject", "speed-changed duplicate"),
        speed_change),
    "dup_trim": (
        Variant("dup_trim", {"originality": "fail"}, "reject", "trimmed duplicate"), trim),
}


# Variants whose label is about hands_visible. They are only built from clips whose hands are
# (assumed) visible, and they leave the other checks' labels unknown (the zoom changes them).
HAND_VARIANTS = ("hands_out", "hand_out_one", "hands_out_both", "hand_truncated",
                 "no_manipulation")


def apply_variant(name: str, clip: Clip) -> tuple[Clip, Variant]:
    variant, fn = VARIANTS[name]
    return Clip(fn(clip.frames), clip.fps, dict(clip.meta)), variant
