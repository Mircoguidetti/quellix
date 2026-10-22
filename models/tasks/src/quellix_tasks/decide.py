"""Turn the head's probability and the alignment into the worker's `task_completed`
measurements (see services/worker/CLAUDE.md): `completed` true / false / null, `confidence`,
`start_s`, `end_s`, `steps`, plus extra detail for step timestamps (#31) and hints (#22)."""

from __future__ import annotations

from collections.abc import Sequence
from typing import Any

import numpy as np

from .features import Analysis
from .head import Head


def measurements(
    analysis: Analysis, head: Head, step_names: Sequence[str], times_s: np.ndarray
) -> dict[str, Any]:
    p = float(head.proba(analysis.features)[0])
    if p >= head.accept_at:
        completed: bool | None = True
    elif p <= head.reject_at:
        completed = False
    else:
        completed = None     # doubtful -> the worker sends it to review, never accept

    steps: list[dict[str, Any]] = []
    for seg, ok, name in zip(analysis.segments, analysis.found, step_names, strict=True):
        entry: dict[str, Any] = {"name": name, "found": ok,
                                 "score": round(seg.score, 3) if seg.found else None}
        if ok and seg.start is not None and seg.end is not None:
            entry.update(t_s=round(float(times_s[seg.start]), 2),
                         start_s=round(float(times_s[seg.start]), 2),
                         end_s=round(float(times_s[seg.end]), 2))
        steps.append(entry)
    found = [s for s in steps if s["found"]]
    m: dict[str, Any] = {
        "completed": completed,
        "confidence": round(max(p, 1.0 - p), 4),
        "p_completed": round(p, 4),
        "steps": steps,
        "missing_steps": [s["name"] for s in steps if not s["found"]],
        "final_state_score": round(analysis.final_state_end, 3),
    }
    if found:
        m["start_s"] = found[0]["start_s"]
        m["end_s"] = found[-1]["end_s"]
    return m
