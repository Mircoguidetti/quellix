import json
from pathlib import Path

import numpy as np
import pytest
from quellix_hands.model import HandsModel
from quellix_hands.types import RawHand

from quellix_eval import hands_score as hs
from quellix_eval.defects import write_video


def keypoints(cx, wrist_y=0.97, size=0.25, closed=True):
    """Closed hand pointing up, wrist at wrist_y (bottom of the frame)."""
    kp = np.zeros((21, 2))
    wrist = np.array([cx, wrist_y])
    kp[0] = wrist
    for f, a in enumerate(np.deg2rad([-40, -15, 0, 15, 30])):
        d = np.array([np.sin(a), -np.cos(a)])
        reach = 1.1 if closed else 1.9
        for j in range(4):
            kp[1 + f * 4 + j] = wrist + d * size * 0.5 * (1.0 + (reach - 1.0) * j / 3 + 0.0)
        kp[1 + f * 4] = wrist + d * size * 0.5
    return kp


class TwoHands:
    """Always finds both hands, wrist at the bottom edge of the frame, whatever the frame is."""

    name = "two-hands@test"

    def __init__(self, calls=None):
        self.calls = calls if calls is not None else []

    def detect(self, rgb):
        self.calls.append(1)
        return [RawHand("right", 0.9, keypoints(0.3)), RawHand("right", 0.9, keypoints(0.7))]


def video(tmp_path, seconds=6, fps=8):
    frames = [np.full((72, 128, 3), 90, np.uint8) for _ in range(seconds * fps)]
    p = tmp_path / "v.mp4"
    write_video(p, frames, fps)
    return p


def test_cached_detector_runs_the_detector_once_per_frame_for_every_model():
    calls = []
    det = hs.CachedDetector(TwoHands(calls))
    frame = np.zeros((10, 10, 3), np.uint8)
    for _ in range(3):
        det.detect(frame)
    assert len(calls) == 1
    det.clear()
    det.detect(frame)
    assert len(calls) == 2


def scored(expected, **status):
    return hs.Scored("c", expected, dict(status))


def test_pick_threshold_takes_the_lowest_error_sum_and_the_higher_threshold_on_a_tie():
    dev = [scored("pass", **{"v1@0.5": "fail", "v1@0.3": "pass", "v1@0.2": "pass"}),
           scored("pass", **{"v1@0.5": "fail", "v1@0.3": "pass", "v1@0.2": "pass"}),
           scored("fail", **{"v1@0.5": "fail", "v1@0.3": "fail", "v1@0.2": "pass"})]
    assert hs.pick_threshold(dev) == 0.3          # 0.2 lets a bad clip through
    tie = [scored("pass", **{"v1@0.5": "pass", "v1@0.3": "pass", "v1@0.2": "pass"})]
    assert hs.pick_threshold(tie) == 0.5


def test_metrics_for_counts_both_error_types_and_ignores_unlabelled():
    rows = [scored("pass", v0="fail"), scored("pass", v0="pass"), scored("fail", v0="pass"),
            scored("fail", v0="fail"), scored("unknown", v0="pass"), scored("pass", v0="error")]
    m = hs.metrics_for(rows, "v0")
    assert (m.false_reject_rate.k, m.false_reject_rate.n) == (1, 3)
    assert (m.false_accept_rate.k, m.false_accept_rate.n) == (1, 2)
    assert m.n == 5 and m.review_rate.k == 1          # "error" counts as review


def test_the_fix_changes_the_check_for_hands_whose_wrist_is_at_the_frame_edge(tmp_path):
    inner = hs.CachedDetector(TwoHands())
    models = {"v0": HandsModel.v0(inner), "v1@0.5": HandsModel(inner)}
    rubric = json.loads(hs.RUBRIC.read_text())
    res = hs.score_clip("clip", video(tmp_path), "pass", models, [inner], rubric)
    assert res.status["v0"] == "fail" and res.ratio["v0"] == 0.0     # wrist on the edge: "cut"
    assert res.status["v1@0.5"] == "pass" and res.ratio["v1@0.5"] == 1.0


def test_report_shows_before_and_after_and_the_rule(tmp_path):
    rows = [scored("pass", **{"v0": "fail", "v1@0.3": "pass"}),
            scored("fail", **{"v0": "fail", "v1@0.3": "fail"})]
    free = [hs.Scored("hero", "unknown", {"v0": "fail", "v1@0.3": "pass"},
                      {"v0": 0.46, "v1@0.3": 0.9})]
    text = hs.report(0.3, rows, rows, rows, free, {"minutes": 1})
    assert "before (v0)" in text and "after (v1@0.3)" in text
    assert "Picked **0.3**" in text and "hero" in text and "0.46" in text and "0.90" in text
    assert "false reject rate" in text and "false accept rate" in text


def test_overlay_pairs_helper_is_import_safe():
    assert callable(hs.holo_overlay_pairs) and Path(hs.RUBRIC).exists()


def test_check_status_rubric_is_the_benchmarks_hands_rubric():
    r = json.loads(hs.RUBRIC.read_text())
    cfg = r["checks"]["hands_visible"]
    assert cfg["require_both"] and cfg["scope"] == "manipulation" and cfg["min_ratio"] == 0.8
    with pytest.raises(KeyError):
        hs.build_models({})
