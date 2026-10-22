"""Quick rejection metrics for training reports. The numbers that count come from `eval`."""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import asdict, dataclass

import numpy as np


@dataclass(frozen=True)
class RejectMetrics:
    n: int
    base_reject_rate: float
    reject_precision: float | None
    reject_recall: float
    false_accept_rate: float      # not-completed videos accepted
    false_reject_rate: float      # completed videos rejected
    review_rate: float

    def as_dict(self) -> dict[str, float | int | None]:
        return asdict(self)


def decisions(p: np.ndarray, reject_at: float, accept_at: float) -> list[str]:
    return ["accept" if x >= accept_at else "reject" if x <= reject_at else "review" for x in p]


def reject_metrics(pred: Sequence[str], completed: Sequence[bool]) -> RejectMetrics:
    """`completed` False = the truth is reject (task not completed)."""
    n = len(pred)
    truth_reject = np.array([not c for c in completed])
    pr = np.array([d == "reject" for d in pred])
    pa = np.array([d == "accept" for d in pred])
    tp = int((pr & truth_reject).sum())
    neg, pos = int(truth_reject.sum()), int((~truth_reject).sum())
    return RejectMetrics(
        n=n,
        base_reject_rate=neg / n if n else 0.0,
        reject_precision=tp / int(pr.sum()) if pr.any() else None,
        reject_recall=tp / neg if neg else 0.0,
        false_accept_rate=int((pa & truth_reject).sum()) / neg if neg else 0.0,
        false_reject_rate=int((pr & ~truth_reject).sum()) / pos if pos else 0.0,
        review_rate=float(np.mean([d == "review" for d in pred])) if n else 0.0,
    )
