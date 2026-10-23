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
BANDS = (0.0, 0.1, 0.2, 0.3)     # "uncertain" band widths below the rubric minimum (proposal, #4)
MAX_DEV_FRR = 0.10               # pick_band: the smallest band whose dev FRR is at most this


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
    label_ratio: float | None = None    # HoloAssist: share of manipulation frames, both visible


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


def banded_status(s: Scored, model: str, band: float, min_ratio: float = 0.8) -> str | None:
    """The check status with an "uncertain" band: a `fail` whose ratio is within `band` of the
    rubric minimum becomes `uncertain` (review). Other statuses are unchanged. This is how the
    rubric would behave with the proposed change (#4); the worker does not do it yet."""
    status, ratio = s.status.get(model), s.ratio.get(model)
    if status == "fail" and ratio is not None and band > 0 and ratio >= min_ratio - band - 1e-9:
        return "uncertain"
    return status


def metrics_banded(scored: Sequence[Scored], model: str, band: float) -> Metrics:
    pairs = [p for s in scored if (p := check_pairs(s.expected, banded_status(s, model, band)))]
    return metrics(pairs)


def pick_band(dev: Sequence[Scored], model: str, bands: Sequence[float] = BANDS) -> float:
    """The smallest band whose dev false reject rate is at most MAX_DEV_FRR; if none reaches it,
    the band with the lowest dev FRR (ties to the smaller band). Written before any val window
    is scored with a band. A wider band costs review time, so smaller wins ties."""
    best, best_frr = bands[0], float("inf")
    for b in sorted(bands):
        frr = metrics_banded(dev, model, b).false_reject_rate.value
        frr = 1.0 if frr is None else frr
        if frr <= MAX_DEV_FRR:
            return b
        if frr < best_frr - 1e-9:
            best, best_frr = b, frr
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
    free: Sequence[Scored], extra: Mapping[str, Any], band: float | None = None,
    thresholds: Sequence[float] = THRESHOLDS,
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
    good = [s for s in val if s.expected == "pass"]
    if good:
        lines += ["### Validation windows labelled pass, one by one", "",
                  "Label ratio = share of manipulation frames with both hands fully visible in "
                  "HoloAssist's own hand tracking; the others are the model's measurements.", "",
                  "| window | label ratio | before | status | after | status |",
                  "|---|---|---|---|---|---|"]
        for s in good:
            b, a = s.ratio.get("v0"), s.ratio.get(after)
            lines.append(f"| {s.clip_id} | {s.label_ratio} | {b} | {s.status.get('v0')} | {a} "
                         f"| {s.status.get(after)} |")
        lines.append("")
    lines += ["## Dev slice (HoloAssist train windows): how the threshold was chosen", "",
              table([("before (v0)", metrics_for(dev, "v0"))]
                    + [(f"v1, detector {t}", metrics_for(dev, f"v1@{t}")) for t in thresholds]),
              f"Rule: lowest false reject rate + false accept rate; ties go to the higher "
              f"threshold. Picked **{chosen}**.", ""]
    if band is not None:
        lines += ["## Proposed \"uncertain\" band (not in the worker yet: needs the rubric change "
                  "on #4)", "",
                  f"A `fail` whose ratio is within the band below the minimum (0.8) becomes "
                  f"`uncertain` (review). The band was chosen on the dev slice with this rule: the "
                  f"smallest band whose dev false reject rate is at most {MAX_DEV_FRR}, else the "
                  f"one with the lowest; picked **{band}**.", "",
                  "Dev slice:", "",
                  table([(f"after, band {b}", metrics_banded(dev, after, b)) for b in BANDS]),
                  "Validation windows, scored once with the chosen band:", "",
                  table([("before (v0)", metrics_for(val, "v0")),
                         (f"after ({after})", metrics_for(val, after)),
                         (f"after + band {band}", metrics_banded(val, after, band))])]
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

    models: dict[str, Any] = {"v0": HandsModel.v0(detectors[0.5])}   # v0's own threshold
    for t, d in detectors.items():
        models[f"v1@{t}"] = HandsModel(d)
    return models


def make_detectors(
    thresholds: Sequence[float] = THRESHOLDS,
) -> dict[float, CachedDetector]:  # pragma: no cover - models
    from quellix_hands.detectors import MediaPipeDetector

    return {t: CachedDetector(MediaPipeDetector(min_detection_confidence=t,
                                                 min_presence_confidence=t))
            for t in sorted({0.5, *thresholds}, reverse=True)}


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
        scored[-1].label_ratio = json.loads(c.notes or "{}").get("both_visible_ratio")
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


# Pexels clips (Pexels License): the landing clips and the third-person test set. Listed here
# rather than imported from the site-clips code, which is not on `main` yet (PR #75).
PEXELS_CLIPS: tuple[tuple[int, str, str], ...] = (
    (7204592, "Washing up in the sink", "first-person"),
    (7418650, "Making a salad", "first-person"),
    (37443407, "Whipping cream with an electric mixer", "first-person"),
    (7658012, "Putting ground coffee in a filter", "first-person"),
    (7308220, "Folding laundry", "third-person"),
    (4520150, "Packing jeans in a box", "third-person"),
    (11102752, "Cooking in a pot", "third-person"),
    (5592524, "Cleaning a countertop", "third-person"),
    (4440711, "Loading a washing machine", "third-person"),
    (7641501, "Washing cups", "third-person"),
    (9141844, "Putting folded clothes in a bag", "third-person"),
)
PEXELS_DOWNLOAD = "https://www.pexels.com/download/video/{id}/"
USER_AGENT = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124"


def download(url: str, dst: Path) -> None:  # pragma: no cover - network
    import urllib.request

    dst.parent.mkdir(parents=True, exist_ok=True)
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=120) as r, open(dst, "wb") as f:  # noqa: S310
        while chunk := r.read(1 << 20):
            f.write(chunk)


def run_pexels(work: Path, models: Mapping[str, Any], detectors: Sequence[CachedDetector],
               rubric: Mapping[str, Any], fetch: Any = download) -> list[Scored]:
    """Download each Pexels clip, score it, delete it. A failed download is skipped."""
    out = []
    for pid, task, view in PEXELS_CLIPS:
        path = work / f"pexels_{pid}.mp4"
        try:
            fetch(PEXELS_DOWNLOAD.format(id=pid), path)
        except Exception as e:  # noqa: BLE001 - one missing clip must not end the run
            print(f"pexels {pid}: {type(e).__name__}: {e}", file=sys.stderr)
            continue
        out.append(score_clip(f"pexels_{pid} ({task}, {view})", path, "unknown", models,
                              detectors, rubric, "pexels"))
        path.unlink(missing_ok=True)
    return out


def write_outputs(out: Path, chosen: float, dev: Sequence[Scored], val: Sequence[Scored],
                  synth: Sequence[Scored], free: Sequence[Scored],
                  extra: Mapping[str, Any], band: float | None = None,
                  thresholds: Sequence[float] = THRESHOLDS) -> None:
    """Called after every stage, so a late failure keeps what was already scored."""
    (out / "report.md").write_text(report(chosen, dev, val, synth, free, extra, band, thresholds))
    (out / "scored.json").write_text(json.dumps({
        "chosen": chosen, "dev": [vars(s) for s in dev], "val": [vars(s) for s in val],
        "synthetic": [vars(s) for s in synth], "free": [vars(s) for s in free]}, indent=1))


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
    ap.add_argument("--threshold", type=float, default=None,
                    help="use this detector threshold (already chosen) instead of choosing on dev")
    ap.add_argument("--bands", action="store_true",
                    help="choose an 'uncertain' band on dev and score val with it (proposal, #4)")
    a = ap.parse_args(argv)
    started = time.monotonic()
    a.out.mkdir(parents=True, exist_ok=True)
    rubric = json.loads(RUBRIC.read_text())
    thresholds = (a.threshold,) if a.threshold is not None else THRESHOLDS
    detectors = make_detectors(thresholds)
    models = build_models(detectors)
    if a.threshold is not None:
        models = {k: v for k, v in models.items() if k in ("v0", f"v1@{a.threshold}")}
    dets = list(detectors.values())
    client = httpx.Client(timeout=300, follow_redirects=True)
    remote = holo.Remote(Path(os.environ.get("QUELLIX_HOLO_CACHE", a.out / "cache")), client)
    extra: dict[str, Any] = {}

    dev, dev_clips, st = run_holo("train", a.dev_sessions, a.out / "dev", a.dev_seed, models, dets,
                                  rubric, remote, client)
    extra["dev"] = st
    chosen = a.threshold if a.threshold is not None else pick_threshold(dev)
    band = pick_band(dev, f"v1@{chosen}") if a.bands else None
    extra["band"] = band
    print(f"detector threshold: {chosen}; band: {band}", flush=True)
    keep = {"v0": models["v0"], f"v1@{chosen}": models[f"v1@{chosen}"]}

    val, val_clips, st = run_holo("val", a.val_sessions, a.out / "val", a.seed, keep, dets,
                                  rubric, remote, client)
    extra["val"] = st
    synth: list[Scored] = []
    free: list[Scored] = []
    write_outputs(a.out, chosen, dev, val, synth, free, extra, band, thresholds)
    stages = [("overlays", lambda: holo_overlay_pairs(val_clips, models, chosen,
                                                       a.out / "overlays"))]
    if a.synthetic_sources:
        stages.append(("synthetic", lambda: synth.extend(
            run_synthetic(a.synthetic_sources, a.out / "synthetic", keep, dets, rubric))))
    if a.pexels:
        stages.append(("pexels", lambda: free.extend(
            run_pexels(a.out / "pexels", keep, dets, rubric))))
    for name, stage in stages:
        try:
            stage()
        except Exception as e:  # noqa: BLE001 - keep what is scored, say what failed
            extra[f"{name}_error"] = f"{type(e).__name__}: {e}"
            print(f"stage {name} failed: {e}", file=sys.stderr)
        extra["minutes"] = round((time.monotonic() - started) / 60, 1)
        write_outputs(a.out, chosen, dev, val, synth, free, extra, band, thresholds)
    print((a.out / "report.md").read_text())
    return 0


if __name__ == "__main__":  # pragma: no cover
    sys.exit(main())
