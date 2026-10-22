"""Completion features from the step alignment and the final-state similarity curve."""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from .align import StepSegment, align_steps, standardise

FEATURE_NAMES = (
    "frac_steps_found",     # share of rubric steps with a confident segment
    "min_step_score",       # weakest step (missing steps count as MISSING_SCORE)
    "mean_step_score",
    "last_step_found",
    "last_step_open",       # last found step still running in the final frames: likely cut
    "final_state_rise",     # final-state evidence in the last 15% vs the first half
    "final_state_end",      # final-state evidence in the last 15% (standardised)
    "tail_after_last_s",    # seconds of video after the last found step, capped, / 10
)
MISSING_SCORE = -1.0
FOUND_SCORE = 1.0           # mean evidence a segment needs to count as a found step
END_FRACTION = 0.15


@dataclass(frozen=True)
class Analysis:
    features: np.ndarray            # aligned with FEATURE_NAMES
    segments: list[StepSegment]
    found: list[bool]
    final_state_end: float


def analyse(
    step_sim: np.ndarray, final_sim: np.ndarray | None, times_s: np.ndarray, margin: float = 0.5
) -> Analysis:
    """step_sim: (T, K) cosine similarities frame x step; final_sim: (T,) or None."""
    t_count = step_sim.shape[0]
    z = standardise(step_sim) if t_count > 1 else np.zeros_like(step_sim)
    segments = align_steps(z, margin)
    found = [s.found and s.score >= FOUND_SCORE for s in segments]
    scores = [s.score if f else MISSING_SCORE for s, f in zip(segments, found, strict=True)]
    k = len(segments)

    tail_n = max(1, int(round(END_FRACTION * t_count)))
    last_idx = max((i for i, f in enumerate(found) if f), default=None)
    last_end = segments[last_idx].end if last_idx is not None else None
    last_open = float(last_end is not None and last_end >= t_count - tail_n)
    duration = float(times_s[-1]) if t_count else 0.0
    tail_after = duration - float(times_s[last_end]) if last_end is not None else 0.0

    if final_sim is not None and t_count > 1:
        fz = standardise(final_sim[:, None])[:, 0]
        end_ev = float(fz[-tail_n:].mean())
        rise = end_ev - float(fz[: max(1, t_count // 2)].mean())
    else:
        end_ev, rise = 0.0, 0.0

    feats = np.array([
        sum(found) / k if k else 0.0,
        float(np.clip(min(scores), -3, 3)) if k else 0.0,
        float(np.clip(np.mean(scores), -3, 3)) if k else 0.0,
        float(found[-1]) if k else 0.0,
        last_open,
        float(np.clip(rise, -3, 3)),
        float(np.clip(end_ev, -3, 3)),
        min(tail_after, 30.0) / 10.0,
    ], dtype=np.float64)
    return Analysis(feats, segments, found, end_ev)
