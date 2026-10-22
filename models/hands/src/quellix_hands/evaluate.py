"""Evaluation hook: run the hands model on labelled clips and report per-frame truncation accuracy
and ratio error.

    python -m quellix_hands.evaluate --manifest M.jsonl --labels L.jsonl [--root DIR] [--out R.json]

``--manifest``: the ``eval`` manifest (JSONL, ``eval/src/quellix_eval/datasets/manifest.py``);
only ``clip_id`` and ``path`` are read (``path`` relative to ``--root`` if not absolute).

``--labels``: per-frame hand labels, a sidecar JSONL (one line per clip) because the eval manifest
only has clip-level labels:

    {"clip_id": "c1", "frames": [{"t_s": 0.5, "left": "full", "right": "truncated",
                                   "manipulation": true}, ...]}

``left`` / ``right`` in {"full", "truncated", "absent"}, from the wearer's point of view.
Synthetic crops from ``eval/defects`` can produce these labels for free.

The report never contains generic agreement on the final decision: only per-frame state accuracy,
truncation precision/recall and the absolute error of each ratio, next to the label base rates.
"""

from __future__ import annotations

import argparse
import json
import sys
from collections import Counter
from collections.abc import Sequence
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import numpy as np

from .model import HandsModel
from .types import SIDES, FrameHands

STATES = ("full", "truncated", "absent")
RATIO_KEYS = ("ratio_both_whole", "ratio_any_whole",
              "ratio_both_manipulation", "ratio_any_manipulation")


def read_jsonl(path: Path) -> list[dict[str, Any]]:
    return [json.loads(line) for line in path.read_text().splitlines() if line.strip()]


def frames_at(video_path: Path, timestamps: Sequence[float]) -> list[np.ndarray]:
    """The decoded frame closest to each timestamp (single sequential pass)."""
    import av

    wanted = sorted(set(float(t) for t in timestamps))
    best: dict[float, tuple[float, np.ndarray]] = {}
    with av.open(str(video_path)) as c:
        stream = c.streams.video[0]
        for frame in c.decode(stream):
            if frame.pts is None or frame.time_base is None:
                continue
            t = float(frame.pts * frame.time_base)
            for w in wanted:
                if w not in best or abs(t - w) < best[w][0]:
                    best[w] = (abs(t - w), frame.to_ndarray(format="rgb24"))
            if t > wanted[-1] + 1.0:
                break
    missing = [w for w in wanted if w not in best]
    if missing:
        raise ValueError(f"{video_path}: no frame near t={missing[0]}")
    return [best[float(t)][1] for t in timestamps]


def label_ratios(frames: Sequence[dict[str, Any]]) -> dict[str, float | None]:
    def r(flags: list[bool]) -> float | None:
        return sum(flags) / len(flags) if flags else None

    both = [f["left"] == "full" and f["right"] == "full" for f in frames]
    any_ = [f["left"] == "full" or f["right"] == "full" for f in frames]
    man = [bool(f.get("manipulation")) for f in frames]
    return {
        "ratio_both_whole": r(both),
        "ratio_any_whole": r(any_),
        "ratio_both_manipulation": r([b for b, m in zip(both, man, strict=True) if m]),
        "ratio_any_manipulation": r([a for a, m in zip(any_, man, strict=True) if m]),
    }


@dataclass
class Report:
    confusion: Counter[tuple[str, str]] = field(default_factory=Counter)  # (truth, pred)
    ratio_errors: dict[str, list[float]] = field(
        default_factory=lambda: {k: [] for k in RATIO_KEYS})
    ratio_unavailable: Counter[str] = field(default_factory=Counter)
    clips: list[dict[str, Any]] = field(default_factory=list)

    def add_clip(self, clip_id: str, labels: Sequence[dict[str, Any]],
                 pred_frames: Sequence[FrameHands], pred: dict[str, Any]) -> None:
        for lab, pf in zip(labels, pred_frames, strict=True):
            for side in SIDES:
                self.confusion[(lab[side], pf.hand(side).state)] += 1
        truth = label_ratios(labels)
        errs: dict[str, float | None] = {}
        for k in RATIO_KEYS:
            if truth[k] is None or pred.get(k) is None:
                self.ratio_unavailable[k] += 1
                errs[k] = None
            else:
                e = abs(float(pred[k]) - float(truth[k]))
                self.ratio_errors[k].append(e)
                errs[k] = round(e, 4)
        self.clips.append({"clip_id": clip_id, "n_frames": len(labels), "abs_error": errs})

    def summary(self) -> dict[str, Any]:
        total = sum(self.confusion.values())
        correct = sum(v for (t, p), v in self.confusion.items() if t == p)
        tp = self.confusion[("truncated", "truncated")]
        pred_trunc = sum(v for (_, p), v in self.confusion.items() if p == "truncated")
        true_trunc = sum(v for (t, _), v in self.confusion.items() if t == "truncated")
        return {
            "hand_frames": total,
            "state_accuracy": round(correct / total, 4) if total else None,
            "truncation_precision": round(tp / pred_trunc, 4) if pred_trunc else None,
            "truncation_recall": round(tp / true_trunc, 4) if true_trunc else None,
            "label_base_rates": {s: round(sum(v for (t, _), v in self.confusion.items() if t == s)
                                          / total, 4) if total else None for s in STATES},
            "confusion": {f"{t}->{p}": v for (t, p), v in sorted(self.confusion.items())},
            "ratio_mae": {k: round(float(np.mean(v)), 4) if v else None
                          for k, v in self.ratio_errors.items()},
            "ratio_unavailable": dict(self.ratio_unavailable),
            "clips": self.clips,
        }


def markdown(summary: dict[str, Any], model_id: str) -> str:
    lines = [f"# Hands model evaluation ({model_id})", "",
             f"- hand-frames: {summary['hand_frames']}",
             f"- per-frame state accuracy: {summary['state_accuracy']}",
             f"- truncation precision / recall: {summary['truncation_precision']} / "
             f"{summary['truncation_recall']}",
             f"- label base rates: {summary['label_base_rates']}", "",
             "| ratio | mean abs error | clips without a value |", "|---|---|---|"]
    for k in RATIO_KEYS:
        missing = summary["ratio_unavailable"].get(k, 0)
        lines.append(f"| {k} | {summary['ratio_mae'][k]} | {missing} |")
    return "\n".join(lines) + "\n"


def evaluate(model: HandsModel, manifest: Path, labels: Path, root: Path | None = None) -> Report:
    clips = {c["clip_id"]: c for c in read_jsonl(manifest)}
    report = Report()
    for entry in read_jsonl(labels):
        clip = clips.get(entry["clip_id"])
        if clip is None:
            raise ValueError(f"labels for unknown clip {entry['clip_id']!r}")
        path = Path(clip["path"])
        if not path.is_absolute() and root is not None:
            path = root / path
        lab_frames = sorted(entry["frames"], key=lambda f: f["t_s"])
        ts = [float(f["t_s"]) for f in lab_frames]
        rgb = frames_at(path, ts)
        pred_frames = model.frames(rgb, ts)
        report.add_clip(entry["clip_id"], lab_frames, pred_frames, model.measure(rgb, ts))
    return report


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(prog="python -m quellix_hands.evaluate")
    p.add_argument("--manifest", type=Path, required=True)
    p.add_argument("--labels", type=Path, required=True)
    p.add_argument("--root", type=Path, default=None)
    p.add_argument("--out", type=Path, default=None)
    args = p.parse_args(argv)
    model = HandsModel()
    summary = evaluate(model, args.manifest, args.labels, args.root).summary()
    summary["model_id"] = model.model_id
    if args.out:
        args.out.write_text(json.dumps(summary, indent=2))
    print(markdown(summary, model.model_id))
    return 0


if __name__ == "__main__":
    sys.exit(main())
