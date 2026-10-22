"""Score the hands check before and after the fix (issue #4), both error types with CIs.

    python -m quellix_eval.hands_score --out out/hands --dev-sessions 60 --val-sessions 130 \\
        --synthetic-sources 40 --pexels

What it does, in this order (the order is the point: nothing is tuned on what is scored):
1. **Dev**: HoloAssist *train*-split windows with hand-tracking labels (the same builder as
   benchmark v2's hands slice, a different split). The detector threshold is chosen here, with the
   rule in `pick_threshold`, written down before any val clip is looked at.
2. **Score once**: benchmark v2's hands slice (HoloAssist *validation* windows, the same seed, so
   the same clips) and the synthetic hands slice (Egocentric-10K originals + hand defects), with
   the first version (hands@0.1.0) and the current one on exactly the same decoded frames.
3. **Without labels**: the landing clips and the third-person Pexels clips: the measured ratio and
   the check's status for both versions (no rates: nobody has labelled them).

The check status is what is scored (pass / fail / uncertain): since #76 a hands failure goes to
review, so "fail" means "the check would have rejected".
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import cv2
import numpy as np

from .benchmark.stats import Metrics, check_pairs, metrics

RUBRIC = Path(__file__).resolve().parents[2] / "rubrics" / "benchmark_v2_hands.json"
THRESHOLDS = (0.5, 0.3, 0.2)     # detector min detection / presence confidence candidates


class CachedDetector:
    """One detector pass per frame, shared by every model variant that uses it."""

    def __init__(self, inner: Any) -> None:
        self.inner, self.name = inner, inner.name
        self._cache: dict[int, tuple[np.ndarray, list[Any]]] = {}

    def detect(self, rgb: np.ndarray) -> list[Any]:
        hit = self._cache.get(id(rgb))
        if hit is None:
            hit = (rgb, self.inner.detect(rgb))
            self._cache[id(rgb)] = hit
        return hit[1]

    def clear(self) -> None:
        self._cache.clear()


@dataclass
class Scored:
    clip_id: str
    expected: str                       # "pass" | "fail" | "unknown"
    status: dict[str, str] = field(default_factory=dict)
    ratio: dict[str, float | None] = field(default_factory=dict)
    detected: dict[str, float | None] = field(default_factory=dict)
    source: str = ""


def hands_status(model: Any, video: Any, rubric: Mapping[str, Any]) -> tuple[str, float | None,
                                                                          float | None]:
    """(status, ratio_both_manipulation, share of frames with both hands seen) under the rubric."""
    from quellix_worker import rubric as R
    from quellix_worker.checks.hands import QuellixHandsAdapter

    out = QuellixHandsAdapter(model).predict(video)
    decision = R.evaluate("clip", rubric, {"hands_visible": out})
    m = out.measurements or {}
    status = decision["checks"]["hands_visible"]["status"]
    return status, m.get("ratio_both_manipulation"), m.get("ratio_both_whole")


def score_clip(
    clip_id: str, path: Path, expected: str, models: Mapping[str, Any],
    detectors: Sequence[CachedDetector], rubric: Mapping[str, Any], source: str = "",
) -> Scored:
    from quellix_worker.media import decode

    video = decode(path)
    res = Scored(clip_id, expected, source=source)
    for name, model in models.items():
        res.status[name], res.ratio[name], res.detected[name] = hands_status(model, video, rubric)
    for d in detectors:
        d.clear()
    return res


def metrics_for(scored: Sequence[Scored], model: str) -> Metrics:
    pairs = [p for s in scored if (p := check_pairs(s.expected, s.status.get(model)))]
    return metrics(pairs)


def pick_threshold(dev: Sequence[Scored], candidates: Sequence[float] = THRESHOLDS) -> float:
    """The detector threshold with the lowest false reject rate + false accept rate on dev; ties
    go to the higher (more conservative) threshold. Decided here, before any val clip is scored."""
    best, best_cost = candidates[0], float("inf")
    for t in candidates:
        m = metrics_for(dev, f"v1@{t}")
        cost = (m.false_reject_rate.value or 0.0) + (m.false_accept_rate.value or 0.0)
        if cost < best_cost - 1e-9:
            best, best_cost = t, cost
    return best


def table(rows: Sequence[tuple[str, Metrics]]) -> str:
    out = ["| model | clips | base reject rate | false reject rate | false accept rate "
           "| review rate |", "|---|---|---|---|---|---|"]
    for name, m in rows:
        out.append(f"| {name} | {m.n} | {m.base_reject_rate.fmt()} | {m.false_reject_rate.fmt()} "
                   f"| {m.false_accept_rate.fmt()} | {m.review_rate.fmt()} |")
    return "\n".join(out) + "\n"


def report(
    chosen: float, dev: Sequence[Scored], val: Sequence[Scored], synth: Sequence[Scored],
    free: Sequence[Scored], extra: Mapping[str, Any],
) -> str:
    after = f"v1@{chosen}"
    lines = ["# Hands check, before and after (issue #4)", "",
             f"Before = hands@0.1.0 (the first version), after = hands@0.2.0 with detector "
             f"threshold **{chosen}** (chosen on the dev slice, see below). Same decoded frames, "
             "same rubric (both hands, manipulation, minimum 0.8). A check status of `fail` "
             "means the check would have rejected; since #76 the decision is `review` instead.",
             "", "Every rate has a Wilson 95% interval and its count.", ""]
    for title, scored in (("HoloAssist hand visibility, validation windows (benchmark v2)", val),
                          ("Synthetic hands slice (Egocentric-10K + hand defects)", synth)):
        lines += [f"## {title}", "", table([("before (v0)", metrics_for(scored, "v0")),
                                            (f"after ({after})", metrics_for(scored, after))])]
    lines += ["## Dev slice (HoloAssist train windows): how the threshold was chosen", "",
              table([("before (v0)", metrics_for(dev, "v0"))]
                    + [(f"v1, detector {t}", metrics_for(dev, f"v1@{t}")) for t in THRESHOLDS]),
              f"Rule: lowest false reject rate + false accept rate; ties go to the higher "
              f"threshold. Picked **{chosen}**.", ""]
    if free:
        lines += ["## Clips without labels (measured values only)", "",
                  "| clip | before: both hands, manipulation | status | after: both hands "
                  "| status |",
                  "|---|---|---|---|---|"]
        for s in free:
            b, a = s.ratio.get("v0"), s.ratio.get(after)
            lines.append(f"| {s.clip_id} | {b if b is None else f'{b:.2f}'} | {s.status.get('v0')} "
                         f"| {a if a is None else f'{a:.2f}'} | {s.status.get(after)} |")
        lines.append("")
    lines += ["## Run notes", "", "```json", json.dumps(extra, indent=1, default=str), "```", ""]
    return "\n".join(lines)


def build_models(detectors: Mapping[float, CachedDetector]) -> dict[str, Any]:
    from quellix_hands.model import HandsModel

    models: dict[str, Any] = {"v0": HandsModel.v0(detectors[0.5])}
    for t, d in detectors.items():
        models[f"v1@{t}"] = HandsModel(d)
    return models


def make_detectors() -> dict[float, CachedDetector]:  # pragma: no cover - models
    from quellix_hands.detectors import MediaPipeDetector

    return {t: CachedDetector(MediaPipeDetector(min_detection_confidence=t,
                                                 min_presence_confidence=t))
            for t in THRESHOLDS}


def holo_overlay_pairs(clips: Sequence[Any], models: Mapping[str, Any], chosen: float,
                       out: Path, limit: int = 6) -> None:  # pragma: no cover - models
    """For some windows: the model's decision on the frame at the window's middle, to sit next to
    the projected-joints overlay that benchmark v2 saves for the same session."""
    from .hands_diagnosis import overlay
    from .site_clips import iter_frames

    out.mkdir(parents=True, exist_ok=True)
    for clip in list(clips)[:limit]:
        meta = json.loads(clip.notes)
        a, b = meta["window_s"]
        mid = (b - a) / 2
        samples = list(iter_frames(Path(clip.path), 4.0, mid - 1.0, mid + 1.0))
        if len(samples) < 3:
            continue
        ts, frames = [t for t, _ in samples], [f for _, f in samples]
        now = models[f"v1@{chosen}"].frames(frames, ts)
        before = models["v0"].frames(frames, ts)
        k = len(frames) // 2
        img = overlay(frames[k], now[k], [], models[f"v1@{chosen}"].config.margin,
                      f"{clip.clip_id} label={clip.checks['hands_visible']}", before[k])
        cv2.imwrite(str(out / f"{clip.clip_id}-model.jpg"), cv2.cvtColor(img, cv2.COLOR_RGB2BGR),
                    [cv2.IMWRITE_JPEG_QUALITY, 72])


def run_holo(split: str, n: int, work: Path, seed: int, models: Mapping[str, Any],
             detectors: Sequence[CachedDetector], rubric: Mapping[str, Any],
             remote: Any, client: Any) -> tuple[list[Scored], list[Any], dict[str, Any]]:
    from .benchmark.runner import holo_clips

    work.mkdir(parents=True, exist_ok=True)     # holo_clips writes the annotations file there
    clips, stats = holo_clips("hands", n, work, seed, remote, client, split=split)
    scored = []
    for c in clips:
        scored.append(score_clip(c.clip_id, Path(c.path), c.checks["hands_visible"], models,
                                 detectors, rubric, f"holoassist-{split}"))
        print(f"{split} {c.clip_id}: expected {scored[-1].expected} -> {scored[-1].status}",
              flush=True)
    return scored, clips, stats


def run_synthetic(n: int, work: Path, models: Mapping[str, Any],
                  detectors: Sequence[CachedDetector],
                  rubric: Mapping[str, Any]) -> list[Scored]:  # pragma: no cover - network
    from .benchmark.runner import synthetic_clips

    work.mkdir(parents=True, exist_ok=True)
    clips, _ = synthetic_clips(n, work)
    scored = []
    for c in clips:
        expected = c.checks.get("hands_visible", "unknown")
        if expected not in ("pass", "fail"):
            continue
        scored.append(score_clip(c.clip_id, Path(c.path), expected, models, detectors, rubric,
                                 "synthetic"))
        print(f"synthetic {c.clip_id}: expected {expected} -> {scored[-1].status}", flush=True)
    return scored


def run_pexels(work: Path, models: Mapping[str, Any], detectors: Sequence[CachedDetector],
               rubric: Mapping[str, Any]) -> list[Scored]:  # pragma: no cover - network
    from .datasets import pexels

    net, out = pexels.UrllibNet(), []
    for pick in (*pexels.LANDING_CLIPS, *pexels.THIRD_PERSON):
        try:
            path, _ = pexels.fetch_pick(net, pick, work, os.environ.get("PEXELS_API_KEY", ""),
                                        lambda s: None)
        except Exception as e:  # noqa: BLE001
            print(f"pexels {pick.clip_id}: {e}", file=sys.stderr)
            continue
        view = "first-person" if pick in pexels.LANDING_CLIPS else "third-person"
        out.append(score_clip(f"{pick.clip_id} ({pick.task}, {view})", path, "unknown", models,
                              detectors, rubric, "pexels"))
        path.unlink(missing_ok=True)
    return out


def main(argv: Sequence[str] | None = None) -> int:  # pragma: no cover - network, models
    import httpx

    from .benchmark import holo

    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawTextHelpFormatter)
    ap.add_argument("--out", type=Path, default=Path("out/hands"))
    ap.add_argument("--dev-sessions", type=int, default=60)
    ap.add_argument("--val-sessions", type=int, default=130)
    ap.add_argument("--synthetic-sources", type=int, default=40)
    ap.add_argument("--pexels", action="store_true")
    ap.add_argument("--seed", type=int, default=64, help="val seed: the benchmark's, same clips")
    ap.add_argument("--dev-seed", type=int, default=7)
    a = ap.parse_args(argv)
    started = time.monotonic()
    a.out.mkdir(parents=True, exist_ok=True)
    rubric = json.loads(RUBRIC.read_text())
    detectors = make_detectors()
    models = build_models(detectors)
    dets = list(detectors.values())
    client = httpx.Client(timeout=300, follow_redirects=True)
    remote = holo.Remote(Path(os.environ.get("QUELLIX_HOLO_CACHE", a.out / "cache")), client)
    extra: dict[str, Any] = {}

    dev, dev_clips, st = run_holo("train", a.dev_sessions, a.out / "dev", a.dev_seed, models, dets,
                                  rubric, remote, client)
    extra["dev"] = st
    chosen = pick_threshold(dev)
    print(f"chosen detector threshold: {chosen}", flush=True)
    keep = {"v0": models["v0"], f"v1@{chosen}": models[f"v1@{chosen}"]}

    val, val_clips, st = run_holo("val", a.val_sessions, a.out / "val", a.seed, keep, dets,
                                  rubric, remote, client)
    extra["val"] = st
    holo_overlay_pairs(val_clips, models, chosen, a.out / "overlays")
    synth = run_synthetic(a.synthetic_sources, a.out / "synthetic", keep, dets, rubric) \
        if a.synthetic_sources else []
    free = run_pexels(a.out / "pexels", keep, dets, rubric) if a.pexels else []
    extra["minutes"] = round((time.monotonic() - started) / 60, 1)
    (a.out / "report.md").write_text(report(chosen, dev, val, synth, free, extra))
    (a.out / "scored.json").write_text(json.dumps({
        "chosen": chosen, "dev": [vars(s) for s in dev], "val": [vars(s) for s in val],
        "synthetic": [vars(s) for s in synth], "free": [vars(s) for s in free]}, indent=1))
    print((a.out / "report.md").read_text())
    return 0


if __name__ == "__main__":  # pragma: no cover
    sys.exit(main())
