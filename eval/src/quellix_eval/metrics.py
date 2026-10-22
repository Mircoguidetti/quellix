"""The metrics Ormes is judged on.

Ground truth per video is the final human verdict: `accept` or `reject`
(the lab's outcome when available, otherwise the collector's reviewer).
A prediction is Ormes's decision: `accept`, `reject` or `review`.

We never report generic "agreement": if 85% of videos are acceptable, a system that
accepts everything already agrees 85% of the time. We report rejections.
"""

from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass
from typing import Literal

Prediction = Literal["accept", "reject", "review"]
Truth = Literal["accept", "reject"]


@dataclass(frozen=True)
class Costs:
    """Relative cost of each outcome, in any unit (e.g. USD per video)."""

    false_reject: float = 1.0   # an honest contributor not paid, a dispute
    false_accept: float = 1.0   # a video the lab will throw away, paid for anyway
    review: float = 0.25        # a person watches the video


@dataclass(frozen=True)
class Report:
    n: int
    base_reject_rate: float          # share of videos whose truth is reject
    reject_precision: float | None   # of auto-rejects, share truly bad (None if no rejects)
    reject_recall: float             # of truly bad videos, share auto-rejected
    flag_recall: float               # of truly bad videos, share rejected OR sent to review
    false_reject_rate: float         # of truly good videos, share auto-rejected
    false_accept_rate: float         # of truly bad videos, share auto-accepted
    review_rate: float               # share of all videos sent to review
    cost: float                      # total cost under `costs`
    cost_all_human: float            # cost if a person reviewed every video
    cost_saving: float               # 1 - cost / cost_all_human


def report(pairs: Iterable[tuple[Prediction, Truth]], costs: Costs | None = None) -> Report:
    costs = costs or Costs()
    items = list(pairs)
    n = len(items)
    if n == 0:
        raise ValueError("no items to evaluate")

    bad = sum(1 for _, t in items if t == "reject")
    good = n - bad
    tp = sum(1 for p, t in items if p == "reject" and t == "reject")
    fp = sum(1 for p, t in items if p == "reject" and t == "accept")
    fa = sum(1 for p, t in items if p == "accept" and t == "reject")
    flagged_bad = sum(1 for p, t in items if p in ("reject", "review") and t == "reject")
    reviews = sum(1 for p, _ in items if p == "review")

    cost = fp * costs.false_reject + fa * costs.false_accept + reviews * costs.review
    cost_all_human = n * costs.review

    return Report(
        n=n,
        base_reject_rate=bad / n,
        reject_precision=(tp / (tp + fp)) if (tp + fp) else None,
        reject_recall=(tp / bad) if bad else 0.0,
        flag_recall=(flagged_bad / bad) if bad else 0.0,
        false_reject_rate=(fp / good) if good else 0.0,
        false_accept_rate=(fa / bad) if bad else 0.0,
        review_rate=reviews / n,
        cost=cost,
        cost_all_human=cost_all_human,
        cost_saving=(1 - cost / cost_all_human) if cost_all_human else 0.0,
    )
