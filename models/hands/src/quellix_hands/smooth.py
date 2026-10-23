"""Temporal smoothing: a hand missed for a moment is not a hand that left.

Frames are sparse samples (the worker takes 4 per second), and a detector misses a hand for a
frame or two when it is blurred, occluded by what it holds, or just under its threshold. If a hand
is seen on both sides of a short gap (``max_gap_s`` or less, 0.5 s by default), the frames in the
gap take its state from its neighbours: ``full`` only when both neighbours are ``full``, else
``truncated``. A hand missing for longer stays absent. Keypoints are interpolated, so contact and
overlays see a hand there; ``filled`` marks those observations.

One guard: a hand is not filled where the other side's detected hand already is (their centres
closer than ``min_separation`` of the frame). That happens when a single hand is labelled left in
one frame and right in the next: filling both sides would turn one hand into two.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import replace

import numpy as np

from .types import SIDES, FrameHands, HandObservation, Side

DEFAULT_MAX_GAP_S = 0.5
MIN_SEPARATION = 0.12  # normalized distance between two hands' centres


def _filled(
    before: HandObservation, after: HandObservation, w: float, side: Side
) -> HandObservation:
    state = "full" if before.state == "full" and after.state == "full" else "truncated"
    kp = None
    if before.keypoints is not None and after.keypoints is not None:
        kp = (1 - w) * np.asarray(before.keypoints, float) + w * np.asarray(after.keypoints, float)
    return HandObservation(side, state, min(before.confidence, after.confidence), kp, None,
                           filled=True)


def _center(h: HandObservation) -> np.ndarray | None:
    if h.keypoints is None:
        return None
    return np.asarray(h.keypoints, dtype=float)[:, :2].mean(axis=0)


def smooth_gaps(frames: Sequence[FrameHands], max_gap_s: float = DEFAULT_MAX_GAP_S,
                min_separation: float = MIN_SEPARATION) -> list[FrameHands]:
    """A copy of ``frames`` with short detection gaps filled (see the module docstring)."""
    if max_gap_s <= 0 or len(frames) < 3:
        return list(frames)
    sides: dict[Side, list[HandObservation]] = {s: [f.hand(s) for f in frames] for s in SIDES}
    ts = [f.t_s for f in frames]
    for side in SIDES:
        obs = sides[side]
        i = 0
        while i < len(obs):
            if obs[i].present:
                i += 1
                continue
            j = i
            while j < len(obs) and not obs[j].present:
                j += 1
            if i > 0 and j < len(obs) and ts[j] - ts[i - 1] <= max_gap_s + 1e-6:
                before, after = obs[i - 1], obs[j]
                span = ts[j] - ts[i - 1]
                other_side: Side = "right" if side == "left" else "left"
                for k in range(i, j):
                    filled = _filled(before, after, (ts[k] - ts[i - 1]) / span, side)
                    mine, theirs = _center(filled), _center(sides[other_side][k])
                    if (mine is not None and theirs is not None and sides[other_side][k].present
                            and float(np.hypot(*(mine - theirs))) < min_separation):
                        continue            # the other side's hand is there: the same hand
                    obs[k] = filled
            i = j
    return [replace(f, left=sides["left"][n], right=sides["right"][n])
            for n, f in enumerate(frames)]
