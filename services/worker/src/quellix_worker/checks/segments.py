"""Times -> merged ``[start_s, end_s]`` runs, for the contributor-facing ``segments``."""

from __future__ import annotations

from collections.abc import Sequence

MERGE_GAP_S = 1.0


def runs(times: Sequence[float], step: float, gap: float = MERGE_GAP_S) -> list[list[float]]:
    """Sorted sample times -> runs ``[first, last + step]``; samples closer than ``gap`` seconds
    belong to the same run (``step`` is how long one sample covers)."""
    out: list[list[float]] = []
    for t in sorted(float(x) for x in times):
        if out and t - (out[-1][1] - step) <= gap + 1e-9:
            out[-1][1] = t + step
        else:
            out.append([t, t + step])
    return [[round(a, 3), round(b, 3)] for a, b in out]


def flagged_runs(times: Sequence[float], flags: Sequence[bool], step: float) -> list[list[float]]:
    return runs([t for t, f in zip(times, flags, strict=True) if f], step)
