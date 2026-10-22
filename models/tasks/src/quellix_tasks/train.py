"""Train the completion head on labelled clips and report rejection metrics on held-out data.

    python -m quellix_tasks.train --manifest ../../eval/data/holoassist.jsonl \\
        --out data/head.json --report data/train_report.json

Labels: `checks.task_completed` pass / fail in `eval` manifests (HoloAssist full vs cut inside
the last action, synthetic truncations, teacher labels after human correction). Clips of one
recording stay in the same split. Thresholds are fitted on out-of-fold probabilities so that
doubt goes to review: at most `--max-false-accept` of not-completed clips may be accepted.
The metrics here are a sanity check; the reported comparison vs Gemini is run in `eval`.
"""

from __future__ import annotations

import argparse
import json
import sys
from collections.abc import Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import numpy as np

from .data import Clip, load_manifest
from .encoder import Encoder, SiglipEncoder
from .head import Head, default_head, fit_logistic, fit_thresholds
from .metrics import decisions, reject_metrics
from .model import TaskModel
from .video import cached_embeddings


@dataclass
class Dataset:
    x: np.ndarray
    y: np.ndarray          # 1 = completed
    groups: np.ndarray
    clip_ids: list[str]


def build_dataset(clips: Sequence[Clip], encoder: Encoder, cache_dir: Path) -> Dataset:
    model = TaskModel(encoder, default_head())
    xs, ys, groups, ids = [], [], [], []
    for clip in clips:
        if clip.completed is None:
            continue
        emb, times = cached_embeddings(clip.path, encoder, cache_dir)
        if len(times) < 3:
            print(f"skip {clip.clip_id}: not decodable or too short", file=sys.stderr)
            continue
        analysis, _ = model.analyse_embeddings(clip.task, emb, times)
        xs.append(analysis.features)
        ys.append(1.0 if clip.completed else 0.0)
        groups.append(clip.group)
        ids.append(clip.clip_id)
    if not xs:
        raise ValueError("no labelled, decodable clips")
    return Dataset(np.stack(xs), np.array(ys), np.array(groups), ids)


def group_folds(groups: np.ndarray, k: int, seed: int) -> list[np.ndarray]:
    uniq = np.unique(groups)
    rng = np.random.default_rng(seed)
    rng.shuffle(uniq)
    return [np.isin(groups, part) for part in np.array_split(uniq, min(k, len(uniq)))]


def out_of_fold(ds: Dataset, folds: int, seed: int, l2: float) -> np.ndarray:
    p = np.full(len(ds.y), np.nan)
    for test in group_folds(ds.groups, folds, seed):
        train = ~test
        if len(np.unique(ds.y[train])) < 2:
            p[test] = ds.y[train].mean()   # degenerate fold: no signal, stays undecided
            continue
        p[test] = fit_logistic(ds.x[train], ds.y[train], l2=l2).proba(ds.x[test])
    return p


def train(
    ds: Dataset, folds: int = 5, seed: int = 0, l2: float = 1.0, holdout: float = 0.2,
    max_false_accept: float = 0.02, min_reject_precision: float = 0.9,
) -> tuple[Head, dict[str, Any]]:
    """-> (head fitted on all data, report with held-out and out-of-fold metrics)."""
    if len(np.unique(ds.y)) < 2:
        raise ValueError("need both completed and not-completed clips")
    test = group_folds(ds.groups, max(2, round(1 / holdout)), seed + 1)[0]
    dev = Dataset(ds.x[~test], ds.y[~test], ds.groups[~test],
                  [c for c, t in zip(ds.clip_ids, test, strict=True) if not t])

    # Held-out estimate: thresholds from dev out-of-fold, head from all of dev.
    oof = out_of_fold(dev, folds, seed, l2)
    r_at, a_at = fit_thresholds(oof, dev.y, max_false_accept, min_reject_precision)
    dev_head = fit_logistic(dev.x, dev.y, l2=l2)
    p_test = dev_head.proba(ds.x[test])
    held_out = reject_metrics(decisions(p_test, r_at, a_at), ds.y[test].astype(bool))
    base = default_head()
    untrained = reject_metrics(decisions(base.proba(ds.x[test]), base.reject_at, base.accept_at),
                               ds.y[test].astype(bool))

    # Final head: all data, thresholds from all-data out-of-fold probabilities.
    oof_all = out_of_fold(ds, folds, seed, l2)
    reject_at, accept_at = fit_thresholds(oof_all, ds.y, max_false_accept, min_reject_precision)
    head = fit_logistic(ds.x, ds.y, l2=l2)
    head.reject_at, head.accept_at = reject_at, accept_at
    head.version = f"trained-n{len(ds.y)}"
    report = {
        "clips": len(ds.y),
        "completed": int(ds.y.sum()),
        "not_completed": int(len(ds.y) - ds.y.sum()),
        "held_out_clips": int(test.sum()),
        "held_out": held_out.as_dict(),
        "held_out_untrained_head": untrained.as_dict(),
        "out_of_fold_all": reject_metrics(decisions(oof_all, reject_at, accept_at),
                                          ds.y.astype(bool)).as_dict(),
        "thresholds": {"reject_at": reject_at, "accept_at": accept_at},
        "settings": {"folds": folds, "seed": seed, "l2": l2, "holdout": holdout,
                     "max_false_accept": max_false_accept,
                     "min_reject_precision": min_reject_precision},
        "note": "sanity check only; compare against Gemini on the same clips in eval",
    }
    return head, report


def main(argv: list[str] | None = None, encoder: Encoder | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawTextHelpFormatter)
    ap.add_argument("--manifest", type=Path, action="append", required=True)
    ap.add_argument("--out", type=Path, required=True, help="trained head JSON")
    ap.add_argument("--report", type=Path, default=None)
    ap.add_argument("--cache-dir", type=Path, default=Path("data/embeddings"))
    ap.add_argument("--folds", type=int, default=5)
    ap.add_argument("--seed", type=int, default=0)
    ap.add_argument("--l2", type=float, default=1.0)
    ap.add_argument("--max-false-accept", type=float, default=0.02)
    ap.add_argument("--min-reject-precision", type=float, default=0.9)
    a = ap.parse_args(argv)
    clips = [c for m in a.manifest for c in load_manifest(m)]
    ds = build_dataset(clips, encoder or SiglipEncoder(), a.cache_dir)
    head, report = train(ds, a.folds, a.seed, a.l2, max_false_accept=a.max_false_accept,
                         min_reject_precision=a.min_reject_precision)
    a.out.parent.mkdir(parents=True, exist_ok=True)
    head.save(a.out)
    text = json.dumps(report, indent=2)
    if a.report:
        a.report.write_text(text + "\n")
    print(text)
    return 0


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
