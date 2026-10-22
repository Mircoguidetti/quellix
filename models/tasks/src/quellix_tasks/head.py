"""Calibrated completion head: logistic regression over `features.FEATURE_NAMES`.

Pure numpy so it trains on a laptop and ships as a few numbers of JSON. The default head is
hand-set, untrained and deliberately cautious (wide abstention band); replace it with one
trained by `quellix_tasks.train` and checked in `eval` before enabling the model.
"""

from __future__ import annotations

import json
import os
from dataclasses import asdict, dataclass, field
from pathlib import Path

import numpy as np

from .features import FEATURE_NAMES


@dataclass
class Head:
    weights: list[float]
    bias: float
    mean: list[float] = field(default_factory=lambda: [0.0] * len(FEATURE_NAMES))
    scale: list[float] = field(default_factory=lambda: [1.0] * len(FEATURE_NAMES))
    # p(completed) >= accept_at -> completed; <= reject_at -> not completed; between -> unsure.
    accept_at: float = 0.9
    reject_at: float = 0.1
    version: str = "default-untrained"
    feature_names: list[str] = field(default_factory=lambda: list(FEATURE_NAMES))

    def __post_init__(self) -> None:
        if list(self.feature_names) != list(FEATURE_NAMES):
            raise ValueError("head was trained on different features; retrain it")
        if not 0.0 <= self.reject_at < self.accept_at <= 1.0:
            raise ValueError("need 0 <= reject_at < accept_at <= 1")

    def proba(self, x: np.ndarray) -> np.ndarray:
        x = np.atleast_2d(x)
        zx = (x - np.asarray(self.mean)) / np.asarray(self.scale)
        return 1.0 / (1.0 + np.exp(-(zx @ np.asarray(self.weights) + self.bias)))

    def save(self, path: Path) -> None:
        path.write_text(json.dumps(asdict(self), indent=2) + "\n")

    @classmethod
    def load(cls, path: Path) -> Head:
        return cls(**json.loads(path.read_text()))


def default_head() -> Head:
    """Signs follow the features' meaning; magnitudes are guesses. Abstains unless clear-cut."""
    w = {
        "frac_steps_found": 2.5, "min_step_score": 1.0, "mean_step_score": 0.5,
        "last_step_found": 1.0, "last_step_open": -3.0, "final_state_rise": 1.0,
        "final_state_end": 1.5, "tail_after_last_s": 0.5,
    }
    return Head([w[n] for n in FEATURE_NAMES], bias=-3.0, accept_at=0.95, reject_at=0.05)


def load_head(path: str | Path | None = None) -> Head:
    """`path`, else $QUELLIX_TASKS_HEAD, else the default head."""
    source = path or os.environ.get("QUELLIX_TASKS_HEAD")
    return Head.load(Path(source)) if source else default_head()


def fit_logistic(
    x: np.ndarray, y: np.ndarray, l2: float = 1.0, steps: int = 3000, lr: float = 0.1
) -> Head:
    """L2-regularised logistic regression by gradient descent on standardised features."""
    mean = x.mean(axis=0)
    scale = np.where(x.std(axis=0) > 1e-9, x.std(axis=0), 1.0)
    zx = (x - mean) / scale
    w = np.zeros(zx.shape[1])
    b = 0.0
    n = len(y)
    for _ in range(steps):
        p = 1.0 / (1.0 + np.exp(-(zx @ w + b)))
        g = p - y
        w -= lr * (zx.T @ g / n + l2 * w / n)
        b -= lr * g.mean()
    return Head(w.tolist(), float(b), mean.tolist(), scale.tolist(), version="trained")


def fit_thresholds(
    p: np.ndarray, y: np.ndarray, max_false_accept: float = 0.02, min_reject_precision: float = 0.9
) -> tuple[float, float]:
    """Pick (reject_at, accept_at) on held-out probabilities. y = 1 completed, 0 not.

    accept_at: lowest cut where at most `max_false_accept` of not-completed videos would be
    accepted. reject_at: highest cut where rejections are at least `min_reject_precision`
    precise. Everything between is sent to review.
    """
    neg = p[y == 0]
    accept_at = 1.0
    for t in np.unique(np.concatenate([p, [1.0]])):
        if neg.size == 0 or (neg >= t).mean() <= max_false_accept:
            accept_at = float(t)
            break
    reject_at = 0.0
    for t in np.unique(p)[::-1]:
        hit = p <= t
        if hit.any() and (y[hit] == 0).mean() >= min_reject_precision:
            reject_at = float(t)
            break
    if reject_at >= accept_at:
        reject_at = float(np.nextafter(accept_at, 0.0))
    return reject_at, max(accept_at, 1e-6)
