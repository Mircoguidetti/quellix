"""Hand-object contact per frame, and manipulation segments over time.

Pluggable: anything implementing ``ContactEstimator`` can replace the v0 heuristic (e.g. a learned
contact head predicting the full 100DOH taxonomy). ``segments_from_contact`` turns any per-frame
contact into ``manipulation_segments``.

v0 heuristic (``HeuristicContact``), per hand, NOT validated yet (see PLAN.md for how it will be
measured). Score in [0, 1] from:
- finger flexion (0.45): fingertips closer to the wrist than an open hand, i.e. gripping;
- position (0.35): hand in the lower part of the frame, where egocentric manipulation happens;
- motion (0.20): the hand moves (wrist speed in frame widths per second).
The score is smoothed with a moving average, then hysteresis (enter >= ``on``, leave < ``off``)
avoids flicker. In contact -> ``"object"`` (type unknown); else ``"none"``; absent -> ``"unknown"``.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from typing import Protocol

import numpy as np

from .types import IN_CONTACT, SIDES, ContactState, FrameHands, HandObservation, Side

# MediaPipe hand keypoint indices.
WRIST = 0
FINGER_MCP = (5, 9, 13, 17)
FINGER_TIP = (8, 12, 16, 20)


class ContactEstimator(Protocol):
    name: str

    def estimate(self, frames: Sequence[FrameHands]) -> list[dict[Side, ContactState]]: ...


def flexion(keypoints: np.ndarray) -> float:
    """0 = open hand, 1 = fist. Ratio of tip-wrist to MCP-wrist distance: ~1.9 open, ~1.1 closed."""
    kp = np.asarray(keypoints, dtype=float)[:, :2]
    wrist = kp[WRIST]
    ratios = []
    for mcp, tip in zip(FINGER_MCP, FINGER_TIP, strict=True):
        base = np.linalg.norm(kp[mcp] - wrist)
        if base > 1e-6:
            ratios.append(np.linalg.norm(kp[tip] - wrist) / base)
    if not ratios:
        return 0.5
    return float(np.clip((1.9 - float(np.mean(ratios))) / 0.8, 0.0, 1.0))


def _center(h: HandObservation) -> tuple[float, float] | None:
    if h.keypoints is not None:
        c = np.asarray(h.keypoints, dtype=float)[:, :2].mean(axis=0)
        return float(c[0]), float(c[1])
    if h.box is not None:
        return (h.box[0] + h.box[2]) / 2, (h.box[1] + h.box[3]) / 2
    return None


def _moving_average(x: np.ndarray, valid: np.ndarray, t: np.ndarray, window_s: float) -> np.ndarray:
    out = np.zeros_like(x)
    for i in range(len(x)):
        sel = valid & (np.abs(t - t[i]) <= window_s / 2)
        out[i] = x[sel].mean() if sel.any() else 0.0
    return out


@dataclass
class HeuristicContact:
    name: str = "contact-heuristic@0.1.0"
    w_flex: float = 0.45
    w_pos: float = 0.35
    w_motion: float = 0.20
    on: float = 0.55
    off: float = 0.40
    window_s: float = 1.0
    speed_full: float = 0.25  # frame widths per second that count as "clearly moving"

    def scores(self, frames: Sequence[FrameHands], side: Side) -> tuple[np.ndarray, np.ndarray]:
        n = len(frames)
        t = np.array([f.t_s for f in frames], dtype=float)
        score = np.zeros(n)
        valid = np.zeros(n, dtype=bool)
        prev: tuple[float, float, float] | None = None  # (t, x, y)
        for i, f in enumerate(frames):
            h = f.hand(side)
            c = _center(h) if h.present else None
            if c is None:
                prev = None
                continue
            flex = flexion(h.keypoints) if h.keypoints is not None else 0.5
            pos = float(np.clip((c[1] - 0.3) / 0.3, 0.0, 1.0))
            motion = 0.0
            if prev is not None and f.t_s > prev[0]:
                speed = float(np.hypot(c[0] - prev[1], c[1] - prev[2])) / (f.t_s - prev[0])
                motion = float(np.clip(speed / self.speed_full, 0.0, 1.0))
            prev = (f.t_s, c[0], c[1])
            score[i] = self.w_flex * flex + self.w_pos * pos + self.w_motion * motion
            valid[i] = True
        return _moving_average(score, valid, t, self.window_s), valid

    def estimate(self, frames: Sequence[FrameHands]) -> list[dict[Side, ContactState]]:
        out: list[dict[Side, ContactState]] = [{} for _ in frames]
        for side in SIDES:
            smooth, valid = self.scores(frames, side)
            on = False
            for i in range(len(frames)):
                if not valid[i]:
                    on = False
                    out[i][side] = "unknown"
                    continue
                on = smooth[i] >= (self.off if on else self.on)
                out[i][side] = "object" if on else "none"
        return out


def segments_from_contact(
    timestamps: Sequence[float],
    contact: Sequence[dict[Side, ContactState]],
    max_gap_s: float = 1.0,
    min_segment_s: float = 0.5,
) -> list[list[float]]:
    """Frames where any hand touches an object -> merged ``[[start_s, end_s], ...]``.

    Gaps up to ``max_gap_s`` are bridged; segments shorter than ``min_segment_s`` are dropped,
    except when the whole clip is a single short segment (very short clips).
    """
    t = [float(x) for x in timestamps]
    active = [any(c.get(s) in IN_CONTACT for s in SIDES) for c in contact]
    raw: list[list[float]] = []
    for ti, a in zip(t, active, strict=True):
        if not a:
            continue
        if raw and ti - raw[-1][1] <= max_gap_s:
            raw[-1][1] = ti
        else:
            raw.append([ti, ti])
    if not raw:
        return []
    kept = [s for s in raw if s[1] - s[0] >= min_segment_s]
    clip_len = t[-1] - t[0] if t else 0.0
    if not kept and len(raw) == 1 and clip_len < min_segment_s * 2:
        return raw
    return kept
