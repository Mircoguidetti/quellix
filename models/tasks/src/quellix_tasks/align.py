"""In-order step alignment over per-frame step similarities.

Each rubric step gets at most one contiguous segment of frames, segments are in the rubric's
order and do not overlap, frames between them are background, and a step may be missing.
The best alignment maximises the summed evidence of the frames each step claims; evidence is
the per-step standardised similarity minus a margin, so a step only claims frames that look
more like it than its typical frame. Missing steps are what a "not completed" video looks like.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

NEG = -1e18


@dataclass(frozen=True)
class StepSegment:
    index: int
    start: int | None   # frame indices, inclusive; None = step not found
    end: int | None
    score: float        # mean evidence over the segment (before the margin); -inf if missing

    @property
    def found(self) -> bool:
        return self.start is not None


def standardise(sim: np.ndarray, min_spread: float = 0.02) -> np.ndarray:
    """Per-step z-score over time (robust: median / MAD), so text-prompt bias cancels out.

    `min_spread` is a floor in cosine units: a step that never appears has a flat, noisy
    curve, and without the floor its noise would be blown up into confident-looking peaks.
    """
    med = np.median(sim, axis=0, keepdims=True)
    mad = np.median(np.abs(sim - med), axis=0, keepdims=True) * 1.4826
    spread = np.maximum(mad, sim.std(axis=0, keepdims=True) * 0.5)
    return (sim - med) / np.maximum(spread, min_spread)


def align_steps(z: np.ndarray, margin: float = 0.5) -> list[StepSegment]:
    """z: (T frames, K steps) standardised evidence. Returns one StepSegment per step."""
    t_count, k_count = z.shape
    if k_count == 0:
        return []
    if t_count == 0:
        return [StepSegment(k, None, None, float("-inf")) for k in range(k_count)]
    gain = z - margin
    n_states = 2 * k_count + 1          # 2k = gap with k steps settled, 2k+1 = inside step k
    score = np.full(n_states, NEG)
    score[0] = 0.0
    back = np.zeros((t_count, n_states), dtype=np.int32)
    skip_from = np.zeros((t_count + 1, k_count + 1), dtype=np.int32)

    def close_gaps(s: np.ndarray, row: np.ndarray) -> None:
        # Epsilon edges: a step can be skipped (gap k -> gap k+1) without consuming a frame.
        for k in range(k_count + 1):
            row[k] = 2 * k
            if k and s[2 * (k - 1)] > s[2 * k]:
                s[2 * k] = s[2 * (k - 1)]
                row[k] = row[k - 1]

    close_gaps(score, skip_from[0])
    for t in range(t_count):
        new = np.full(n_states, NEG)
        for s in range(n_states):
            if s % 2 == 0:        # background frame: stay in this gap
                cands = [(score[s], s)]
                if s >= 1:          # or close the previous step
                    cands.append((score[s - 1], s - 1))
                new[s], back[t, s] = max(cands)
            else:                   # frame belongs to step k = s // 2
                k = s // 2
                cands = [(score[s], s), (score[s - 1], s - 1)]
                if k >= 1:          # step k starts right after step k-1 ends
                    cands.append((score[s - 2], s - 2))
                best, prev = max(cands)
                new[s], back[t, s] = best + gain[t, k], prev
        score = new
        close_gaps(score, skip_from[t + 1])

    # Backtrack from the best final state (any gap/step state counts; trailing steps may skip).
    end_state = int(np.argmax(score))
    states = np.empty(t_count, dtype=np.int32)
    s = end_state
    for t in range(t_count - 1, -1, -1):
        if s % 2 == 0:              # undo a skip chain that led into this gap
            s = int(skip_from[t + 1][s // 2])
        states[t] = s
        s = int(back[t, s])

    segments = []
    for k in range(k_count):
        idx = np.flatnonzero(states == 2 * k + 1)
        if idx.size == 0:
            segments.append(StepSegment(k, None, None, float("-inf")))
        else:
            segments.append(StepSegment(k, int(idx[0]), int(idx[-1]), float(z[idx, k].mean())))
    return segments
