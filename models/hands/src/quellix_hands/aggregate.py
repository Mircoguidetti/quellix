"""Per-frame results -> the worker's ``hands_visible`` measurements (services/worker/CLAUDE.md).

- ``ratio_both_whole`` / ``ratio_any_whole``: share of all sampled frames where both hands / at
  least one hand is fully visible (wrist to fingertips, not cut by the frame edge).
- ``ratio_both_manipulation`` / ``ratio_any_manipulation``: the same, restricted to frames inside
  ``manipulation_segments``. **null** when no manipulation was detected, with
  ``manipulation_detected: false`` and a ``note``. A null ratio must lead to ``review``,
  never to a pass or fail: "no manipulation seen" is not evidence that the hands were visible.

Extra keys (allowed by the decision schema, which keeps measurements free-form): per-hand
ratios, ``n_frames``, ``low_frame_count``, and how often each contact state was seen.
"""

from __future__ import annotations

from collections import Counter
from collections.abc import Sequence
from typing import Any

from .types import SIDES, FrameHands

MIN_FRAMES = 4  # below this the ratios are flagged as unreliable (very short clip)


def _ratio(flags: Sequence[bool]) -> float | None:
    return round(sum(flags) / len(flags), 4) if flags else None


def _in_segments(t: float, segments: Sequence[Sequence[float]]) -> bool:
    return any(s[0] <= t <= s[1] for s in segments)


def aggregate(frames: Sequence[FrameHands], segments: Sequence[Sequence[float]]) -> dict[str, Any]:
    both = [f.left.full and f.right.full for f in frames]
    any_ = [f.left.full or f.right.full for f in frames]
    inside = [_in_segments(f.t_s, segments) for f in frames]
    both_m = [b for b, i in zip(both, inside, strict=True) if i]
    any_m = [a for a, i in zip(any_, inside, strict=True) if i]

    m: dict[str, Any] = {
        "ratio_both_whole": _ratio(both),
        "ratio_any_whole": _ratio(any_),
        "ratio_both_manipulation": _ratio(both_m),
        "ratio_any_manipulation": _ratio(any_m),
        "manipulation_segments": [[round(float(a), 3), round(float(b), 3)] for a, b in segments],
        "manipulation_detected": bool(both_m),
        "n_frames": len(frames),
        "n_frames_manipulation": len(both_m),
        "low_frame_count": len(frames) < MIN_FRAMES,
    }
    for side in SIDES:
        hands = [f.hand(side) for f in frames]
        m[f"ratio_{side}_full_whole"] = _ratio([h.full for h in hands])
        m[f"ratio_{side}_truncated_whole"] = _ratio([h.state == "truncated" for h in hands])
        m[f"ratio_{side}_full_manipulation"] = _ratio(
            [h.full for h, i in zip(hands, inside, strict=True) if i])
        m[f"contact_{side}"] = dict(Counter(f.contact.get(side, "unknown") for f in frames))
    if not frames:
        m["note"] = "No frames were analysed."
    elif not both_m:
        m["note"] = ("No manipulation was detected, so the manipulation ratios are null. "
                     "Send to review; do not treat as a pass.")
    elif m["low_frame_count"]:
        m["note"] = f"Only {len(frames)} frames analysed; ratios are unreliable."
    return m
