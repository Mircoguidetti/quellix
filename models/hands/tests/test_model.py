from dataclasses import dataclass

import numpy as np
import pytest
from synthetic import ColorBlobDetector, draw_frame

from quellix_hands import HandsModel
from quellix_hands.model import without_nulls

CONTRACT = {"ratio_both_manipulation", "ratio_any_manipulation", "ratio_both_whole",
            "ratio_any_whole", "manipulation_segments"}


class FirstHalfContact:
    """A pluggable contact estimator: manipulation during the first half of the clip."""

    name = "first-half@test"

    def estimate(self, frames):
        half = len(frames) // 2
        return [{"left": "object", "right": "object"} if i < half
                else {"left": "none", "right": "none"} for i in range(len(frames))]


def _clip(n=8):
    frames, ts = [], []
    for i in range(n):
        right = (0.6, 0.5, 0.8, 0.9) if i % 2 == 0 else (0.85, 0.5, 1.3, 0.9)  # every other cut
        frames.append(draw_frame({"left": (0.2, 0.5, 0.4, 0.9), "right": right}))
        ts.append(i * 0.25)
    return frames, ts


def test_measure_returns_the_worker_contract():
    model = HandsModel(detector=ColorBlobDetector(), contact=FirstHalfContact())
    frames, ts = _clip()
    m = model.measure(frames, ts)
    assert m.keys() >= CONTRACT
    assert model.model_id == "hands@0.2.0" == model.name
    assert m["ratio_both_whole"] == 0.5
    assert m["ratio_any_whole"] == 1.0
    assert m["manipulation_segments"] == [[0.0, 0.75]]
    assert m["ratio_both_manipulation"] == 0.5
    assert m["detector"] == "colorblob@test" and m["contact_model"] == "first-half@test"
    for k in ("ratio_both_whole", "ratio_any_whole"):
        assert 0.0 <= m[k] <= 1.0


def test_measure_video_is_duck_typed_on_the_worker_decoded_video():
    @dataclass
    class Frame:
        t_s: float
        rgb: np.ndarray

    @dataclass
    class Video:
        frames: list

    frames, ts = _clip()
    model = HandsModel(detector=ColorBlobDetector(), contact=FirstHalfContact())
    video = Video([Frame(t, f) for t, f in zip(ts, frames, strict=True)])
    assert model.measure_video(video) == model.measure(frames, ts)


def test_without_nulls_drops_missing_manipulation_ratios():
    class NoContact:
        name = "none@test"

        def estimate(self, frames):
            return [{"left": "none", "right": "none"} for _ in frames]

    frames, ts = _clip()
    m = HandsModel(detector=ColorBlobDetector(), contact=NoContact()).measure(frames, ts)
    assert m["ratio_both_manipulation"] is None
    clean = without_nulls(m)
    assert "ratio_both_manipulation" not in clean and "ratio_both_whole" in clean


def test_length_mismatch():
    with pytest.raises(ValueError):
        HandsModel(detector=ColorBlobDetector()).measure([draw_frame({})], [0.0, 1.0])


def test_v0_is_the_first_version_for_before_after_scoring():
    model = HandsModel.v0(detector=ColorBlobDetector())
    assert model.model_id == "hands@0.1.0" == model.name
    assert model.smooth_gap_s == 0.0
    assert model.config.check_wrist and not model.config.assign_by_position
    assert model.config.min_confidence == 0.5
