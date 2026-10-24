"""Checks run on a trained head before it is scored on any validation clip. No thresholds change.

    python -m quellix_tasks.checks features --manifest M --cache-dir C --head H \\
        --train-report R --features-out F.json --out checks-features.json
    python -m quellix_tasks.checks serve --features F.json --head H --train-manifest M \\
        --scored-manifest M2 --scored S.json --rubrics DIR --features-check checks-features.json \\
        --out checks.json

1. train/serve consistency (`serve`): `p_completed` returned by the scoring route
   (`quellix-tasks check` with `QUELLIX_TASKS_HEAD`) vs `head.proba` of the training-time
   features of the same clip, and the task text of the rubric vs the one used for training.
2. label-shuffle control (`features`): labels permuted over the training set, session grouping
   kept, same settings; out-of-fold AUC must be near chance.
3. sanity of the real head (`features`): out-of-fold AUC, class means, confusion at the head's
   thresholds. The features must first reproduce the committed head exactly (weights and
   thresholds), which shows they are the matrix the head was fitted on.
"""

from __future__ import annotations

import argparse
import json
import sys
from collections.abc import Sequence
from pathlib import Path
from typing import Any

import numpy as np

from .data import load_manifest
from .encoder import Encoder, SiglipEncoder
from .head import Head, fit_logistic, fit_thresholds
from .library import resolve_task
from .metrics import decisions
from .train import Dataset, build_dataset, out_of_fold, train

# Pass criteria, fixed before any result was seen.
SERVE_MAX_DIFF = 1e-3          # |p_route - head.proba(training features)|
REPRO_TOL = 1e-6               # refit on the saved matrix vs the committed head
SHUFFLE_SEED0_BAND = (0.41, 0.59)   # about +-2 standard errors of a null AUC at ~176 clips
SHUFFLE_MEAN_BAND = (0.45, 0.55)
SHUFFLES = 20


def auc(p: np.ndarray, y: np.ndarray) -> float:
    """P(score of a completed clip > score of a not-completed one), ties count half."""
    pos, neg = p[y == 1], p[y == 0]
    if not len(pos) or not len(neg):
        return float("nan")
    gt = (pos[:, None] > neg[None, :]).sum()
    eq = (pos[:, None] == neg[None, :]).sum()
    return float((gt + 0.5 * eq) / (len(pos) * len(neg)))


def confusion(pred: Sequence[str], y: np.ndarray) -> dict[str, dict[str, int]]:
    out = {"completed": {"accept": 0, "reject": 0, "review": 0},
           "not_completed": {"accept": 0, "reject": 0, "review": 0}}
    for d, t in zip(pred, y, strict=True):
        out["completed" if t == 1 else "not_completed"][d] += 1
    return out


def save_features(ds: Dataset, path: Path) -> None:
    from .features import FEATURE_NAMES
    path.write_text(json.dumps({
        "feature_names": list(FEATURE_NAMES), "clip_ids": ds.clip_ids,
        "groups": ds.groups.tolist(), "y": ds.y.tolist(), "x": ds.x.tolist()}) + "\n")


def load_features(path: Path) -> Dataset:
    d = json.loads(path.read_text())
    return Dataset(np.array(d["x"]), np.array(d["y"]), np.array(d["groups"]), d["clip_ids"])


def reproduce(ds: Dataset, head: Head, settings: dict[str, Any]) -> dict[str, Any]:
    """Refit with the training settings: must give back the committed head."""
    l2, folds, seed = settings["l2"], settings["folds"], settings["seed"]
    refit = fit_logistic(ds.x, ds.y, l2=l2)
    oof = out_of_fold(ds, folds, seed, l2)
    r_at, a_at = fit_thresholds(oof, ds.y, settings["max_false_accept"],
                                settings["min_reject_precision"])
    diff = max(
        float(np.max(np.abs(np.array(refit.weights) - np.array(head.weights)))),
        abs(refit.bias - head.bias),
        float(np.max(np.abs(np.array(refit.mean) - np.array(head.mean)))),
        float(np.max(np.abs(np.array(refit.scale) - np.array(head.scale)))),
        abs(r_at - head.reject_at), abs(a_at - head.accept_at))
    return {"max_abs_diff": diff, "tolerance": REPRO_TOL, "ok": diff <= REPRO_TOL,
            "clips": len(ds.y), "head_version": head.version}


def shuffle_control(ds: Dataset, settings: dict[str, Any]) -> dict[str, Any]:
    kw = {k: settings[k] for k in ("folds", "seed", "l2", "max_false_accept",
                                   "min_reject_precision")}
    aucs, first = [], None
    for s in range(SHUFFLES):
        y = np.random.default_rng(1000 + s).permutation(ds.y)
        shuffled = Dataset(ds.x, y, ds.groups, ds.clip_ids)
        aucs.append(auc(out_of_fold(shuffled, kw["folds"], kw["seed"], kw["l2"]), y))
        if s == 0:
            _, first = train(shuffled, **kw)
    lo, hi = SHUFFLE_SEED0_BAND
    mlo, mhi = SHUFFLE_MEAN_BAND
    mean = float(np.mean(aucs))
    return {"permutations": SHUFFLES, "oof_auc": [round(a, 4) for a in aucs],
            "oof_auc_mean": round(mean, 4), "oof_auc_min": round(min(aucs), 4),
            "oof_auc_max": round(max(aucs), 4),
            "first_permutation_report": {k: first[k] for k in ("out_of_fold_all", "held_out",
                                                                "thresholds")},
            "bands": {"first": [lo, hi], "mean": [mlo, mhi]},
            "ok": bool(lo <= aucs[0] <= hi and mlo <= mean <= mhi)}


def real_head_sanity(ds: Dataset, head: Head, settings: dict[str, Any]) -> dict[str, Any]:
    oof = out_of_fold(ds, settings["folds"], settings["seed"], settings["l2"])
    a = auc(oof, ds.y)
    m1, m0 = float(oof[ds.y == 1].mean()), float(oof[ds.y == 0].mean())
    ins = head.proba(ds.x)
    return {"oof_auc": round(a, 4), "oof_mean_p_completed": round(m1, 4),
            "oof_mean_p_not_completed": round(m0, 4),
            "in_sample_mean_p_completed": round(float(ins[ds.y == 1].mean()), 4),
            "in_sample_mean_p_not_completed": round(float(ins[ds.y == 0].mean()), 4),
            "thresholds": {"reject_at": head.reject_at, "accept_at": head.accept_at},
            "confusion_oof_at_head_thresholds": confusion(
                decisions(oof, head.reject_at, head.accept_at), ds.y),
            "note": "the thresholds were fitted on these same out-of-fold probabilities",
            "ok": bool(a > 0.5 and m1 > m0)}


def cmd_features(a: argparse.Namespace, encoder: Encoder | None = None) -> int:
    clips = load_manifest(a.manifest)
    settings = json.loads(a.train_report.read_text())["train"]["settings"]
    ds = build_dataset(clips, encoder or SiglipEncoder(), a.cache_dir)
    head = Head.load(a.head)
    expected = json.loads(a.train_report.read_text())["train"]["clips"]
    out: dict[str, Any] = {"settings": settings, "manifest_clips": len(clips),
                           "dataset_clips": len(ds.y), "train_report_clips": expected}
    out["same_clips_as_training"] = len(ds.y) == len(clips) == expected
    save_features(ds, a.features_out)
    out["reproduces_head"] = reproduce(ds, head, settings)
    out["real_head"] = real_head_sanity(ds, head, settings)
    out["shuffle_control"] = shuffle_control(ds, settings)
    out["ok"] = bool(out["same_clips_as_training"] and out["reproduces_head"]["ok"]
                     and out["real_head"]["ok"] and out["shuffle_control"]["ok"])
    a.out.write_text(json.dumps(out, indent=1) + "\n")
    print(json.dumps({"ok": out["ok"], "same_clips": out["same_clips_as_training"],
                      "reproduces_head": out["reproduces_head"], "real_head": out["real_head"],
                      "shuffle": {k: out["shuffle_control"][k] for k in (
                          "oof_auc_mean", "oof_auc_min", "oof_auc_max", "ok")}}))
    return 0 if out["ok"] else 1


def _task(task: dict[str, Any]) -> dict[str, Any]:
    t = resolve_task(task)
    return {"description": t.description, "steps": list(t.steps), "final_state": t.final_state,
            "library_id": t.id}


def cmd_serve(a: argparse.Namespace) -> int:
    ds = load_features(a.features)
    head = Head.load(a.head)
    index = {c: i for i, c in enumerate(ds.clip_ids)}
    train_clips = {c.clip_id: c for c in load_manifest(a.train_manifest)}
    scored = json.loads(a.scored.read_text())["rows"]
    rows, problems = [], []
    for r in scored:
        cid = r["clip_id"]
        rub = json.loads((a.rubrics / f"{cid}.rubric.json").read_text())
        if cid not in index:
            problems.append(f"{cid}: not in the training features")
            continue
        p_train = float(head.proba(ds.x[index[cid]])[0])
        p_route = r["p_completed"]
        same_text = (_task(rub["task"]) == _task(train_clips[cid].task)
                     and "library_id" not in rub["task"])
        rows.append({"clip_id": cid, "p_train": round(p_train, 6), "p_route": p_route,
                     "abs_diff": None if p_route is None else abs(p_train - p_route),
                     "same_task_text": same_text})
    diffs = [r["abs_diff"] for r in rows if r["abs_diff"] is not None]
    missing = [r["clip_id"] for r in rows if r["abs_diff"] is None]
    feat = json.loads(a.features_check.read_text())
    serve = {"clips_compared": len(rows), "max_abs_diff": max(diffs) if diffs else None,
             "tolerance": SERVE_MAX_DIFF, "no_p_completed": missing, "problems": problems,
             "all_task_text_equal": all(r["same_task_text"] for r in rows), "rows": rows}
    serve["ok"] = bool(rows and len(rows) == len(scored) and not problems and not missing
                       and serve["max_abs_diff"] <= SERVE_MAX_DIFF
                       and serve["all_task_text_equal"])
    out = {"head_version": head.version, "features": feat, "serve": serve,
           "passed": bool(feat["ok"] and serve["ok"])}
    a.out.write_text(json.dumps(out, indent=1) + "\n")
    print(json.dumps({"passed": out["passed"], "serve_ok": serve["ok"],
                      "max_abs_diff": serve["max_abs_diff"], "features_ok": feat["ok"]}))
    return 0 if out["passed"] else 1


def main(argv: Sequence[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawTextHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("features")
    p.add_argument("--manifest", type=Path, required=True)
    p.add_argument("--cache-dir", type=Path, required=True)
    p.add_argument("--head", type=Path, required=True)
    p.add_argument("--train-report", type=Path, required=True)
    p.add_argument("--features-out", type=Path, required=True)
    p.add_argument("--out", type=Path, required=True)
    p.set_defaults(fn=cmd_features)
    p = sub.add_parser("serve")
    p.add_argument("--features", type=Path, required=True)
    p.add_argument("--head", type=Path, required=True)
    p.add_argument("--train-manifest", type=Path, required=True)
    p.add_argument("--scored", type=Path, required=True)
    p.add_argument("--rubrics", type=Path, required=True)
    p.add_argument("--features-check", type=Path, required=True)
    p.add_argument("--out", type=Path, required=True)
    p.set_defaults(fn=cmd_serve)
    a = ap.parse_args(argv)
    return a.fn(a)


if __name__ == "__main__":  # pragma: no cover
    sys.exit(main())
