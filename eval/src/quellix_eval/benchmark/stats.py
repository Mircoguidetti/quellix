"""Both error types, always, with 95% confidence intervals (Wilson score interval).

Per check: expected label pass / fail (from independent labels) vs the check's status
(pass / fail / uncertain; error and skipped count as uncertain, i.e. review).
Overall: truth accept / reject vs the decision (accept / reject / review; a failed run counts
as review). For both:

- false reject rate = expected pass (accept) but rejected / expected pass
- false accept rate = expected fail (reject) but passed / expected fail
- reject precision, reject recall, flag recall (reject or review), review rate, base reject rate
"""

from __future__ import annotations

import math
from collections.abc import Iterable
from dataclasses import dataclass

Z95 = 1.959963984540054


@dataclass(frozen=True)
class Rate:
    k: int
    n: int

    @property
    def value(self) -> float | None:
        return self.k / self.n if self.n else None

    @property
    def ci(self) -> tuple[float, float] | None:
        return wilson(self.k, self.n)

    def fmt(self) -> str:
        if not self.n:
            return "n/a"
        lo, hi = self.ci  # type: ignore[misc]
        return f"{self.k / self.n:.2f} [{lo:.2f}-{hi:.2f}] ({self.k}/{self.n})"


def wilson(k: int, n: int, z: float = Z95) -> tuple[float, float] | None:
    if n == 0:
        return None
    p = k / n
    denom = 1 + z * z / n
    centre = (p + z * z / (2 * n)) / denom
    half = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / denom
    return max(0.0, centre - half), min(1.0, centre + half)


@dataclass(frozen=True)
class Metrics:
    n: int
    base_reject_rate: Rate
    false_reject_rate: Rate
    false_accept_rate: Rate
    reject_precision: Rate
    reject_recall: Rate
    flag_recall: Rate
    review_rate: Rate

    def rows(self) -> list[tuple[str, Rate]]:
        return [("base reject rate", self.base_reject_rate),
                ("false reject rate", self.false_reject_rate),
                ("false accept rate", self.false_accept_rate),
                ("reject precision", self.reject_precision),
                ("reject recall", self.reject_recall),
                ("flag recall (reject or review)", self.flag_recall),
                ("review rate", self.review_rate)]


def metrics(pairs: Iterable[tuple[str, str]]) -> Metrics:
    """pairs of (truth, predicted) with truth in {"pos", "neg"} where "neg" = should be
    rejected, and predicted in {"pass", "fail", "uncertain"}."""
    pairs = list(pairs)
    neg = [p for t, p in pairs if t == "neg"]
    pos = [p for t, p in pairs if t == "pos"]
    rejected = [t for t, p in pairs if p == "fail"]
    n = len(pairs)
    return Metrics(
        n=n,
        base_reject_rate=Rate(len(neg), n),
        false_reject_rate=Rate(pos.count("fail"), len(pos)),
        false_accept_rate=Rate(neg.count("pass"), len(neg)),
        reject_precision=Rate(rejected.count("neg"), len(rejected)),
        reject_recall=Rate(neg.count("fail"), len(neg)),
        flag_recall=Rate(neg.count("fail") + neg.count("uncertain"), len(neg)),
        review_rate=Rate(sum(1 for _, p in pairs if p == "uncertain"), n),
    )


def check_pairs(expected: str, status: str | None) -> tuple[str, str] | None:
    """(label, status) of one clip and check -> a pair for `metrics`, or None if unlabelled."""
    if expected not in ("pass", "fail"):
        return None
    got = status if status in ("pass", "fail") else "uncertain"
    return ("neg" if expected == "fail" else "pos"), got


def decision_pair(truth: str, decision: str | None) -> tuple[str, str]:
    got = {"accept": "pass", "reject": "fail"}.get(decision or "", "uncertain")
    return ("neg" if truth == "reject" else "pos"), got
