"""Hand visibility. The model lives in models/hands (package ``quellix_hands``); this module
wires it in when it is installed and its weights are present, and otherwise falls back to a
placeholder that sends the video to review."""

from __future__ import annotations

import logging
import os
from functools import lru_cache
from typing import Any, Protocol

from ..media import DecodedVideo
from ..rubric import CheckOutput
from .segments import flagged_runs


class HandsModel(Protocol):
    """Must return the ``hands_visible`` measurement contract (services/worker/CLAUDE.md):
    ratio_both_manipulation, ratio_any_manipulation, ratio_both_whole, ratio_any_whole
    and optionally manipulation_segments [[start_s, end_s], ...]."""

    name: str

    def predict(self, video: DecodedVideo) -> CheckOutput: ...


class PlaceholderHandsModel:
    """PLACEHOLDER: no hands model is configured yet.

    It always returns an error, so the rubric sends the video to ``review``. It never
    lets a video be accepted on hand visibility.
    """

    name = "hands@placeholder"

    def predict(self, video: DecodedVideo) -> CheckOutput:
        return CheckOutput(error="hands model not configured", model=self.name)


log = logging.getLogger(__name__)

RATIO_KEYS = ("ratio_both_manipulation", "ratio_any_manipulation",
              "ratio_both_whole", "ratio_any_whole")


def for_rubric(m: dict[str, Any]) -> dict[str, Any]:
    """The model's measurements, made safe for the rubric.

    Nulls are dropped (``rubric.py`` would crash on ``float(None)``). When no manipulation was
    detected, or too few frames were analysed, the four ratios are removed altogether: the
    rubric then reports "could not be measured" and the video goes to review. "No manipulation
    seen" is not evidence that the hands were visible, so it must never be a pass or a fail.
    """
    out = {k: v for k, v in m.items() if v is not None}
    if not m.get("manipulation_detected") or m.get("low_frame_count"):
        for k in RATIO_KEYS:
            out.pop(k, None)
    return out


def not_full_segments(per_frame: list[Any], manipulation: Any, step: float) -> dict[str, Any]:
    """Intervals where both hands / at least one hand are not fully visible, inside the
    manipulation segments and over the whole video (the rubric's scope picks one)."""
    times = [f.t_s for f in per_frame]
    both = [f.left.full and f.right.full for f in per_frame]
    any_ = [f.left.full or f.right.full for f in per_frame]
    inside = [any(a <= f.t_s <= b for a, b in manipulation) for f in per_frame]
    return {
        "not_both_full_manipulation_segments": flagged_runs(
            times, [i and not b for i, b in zip(inside, both, strict=True)], step),
        "not_any_full_manipulation_segments": flagged_runs(
            times, [i and not a for i, a in zip(inside, any_, strict=True)], step),
        "not_both_full_whole_segments": flagged_runs(times, [not b for b in both], step),
        "not_any_full_whole_segments": flagged_runs(times, [not a for a in any_], step),
    }


class QuellixHandsAdapter:
    """Wraps ``quellix_hands.HandsModel`` as the worker's ``HandsModel``."""

    def __init__(self, model: Any) -> None:
        self._model = model
        self.name = str(model.model_id)

    def predict(self, video: DecodedVideo) -> CheckOutput:
        frames = list(video.frames)
        if hasattr(self._model, "frames"):
            m, per_frame, segments = self._measure_with_frames(frames)
            m.update(not_full_segments(per_frame, segments, 1.0 / video.sample_fps))
        else:  # a model that only offers measure_video(): ratios without exact intervals
            m = self._model.measure_video(video)
        return CheckOutput(measurements=for_rubric(m), model=self.name)

    def _measure_with_frames(self, frames: list[Any]) -> tuple[dict[str, Any], list[Any], Any]:
        """What ``HandsModel.measure`` does, but keeping the per-frame states: the exact
        intervals where a hand is not fully visible are what the contributor needs."""
        from quellix_hands.aggregate import aggregate
        from quellix_hands.contact import segments_from_contact

        m_ = self._model
        per_frame = m_.frames([f.rgb for f in frames], [f.t_s for f in frames])
        segments = segments_from_contact([f.t_s for f in per_frame],
                                         [f.contact for f in per_frame],
                                         m_.max_gap_s, m_.min_segment_s)
        m = aggregate(per_frame, segments)
        m["detector"] = m_.detector.name
        m["contact_model"] = m_.contact.name
        m["margin"] = m_.config.margin
        return m, per_frame, segments


@lru_cache(maxsize=1)
def configured_model() -> HandsModel | None:
    """The real model if ``quellix_hands`` and its weights are available, else None.

    ``QUELLIX_HANDS=off`` forces the placeholder. The detector is created once per process
    (loading the landmarker is the expensive part of a cold start).
    """
    if os.environ.get("QUELLIX_HANDS", "").lower() == "off":
        return None
    try:
        from quellix_hands.model import HandsModel as QuellixHandsModel
        from quellix_hands.weights import default_path, is_valid
    except ImportError:
        return None
    if not is_valid(default_path()):
        log.warning("hands weights not found at %s; using the placeholder", default_path())
        return None
    try:
        return QuellixHandsAdapter(QuellixHandsModel())
    except Exception:  # missing mediapipe / libEGL: placeholder, never a crash at import
        log.exception("could not start the hands model; using the placeholder")
        return None


def run(video: DecodedVideo, model: HandsModel | None = None) -> CheckOutput:
    try:
        return (model or configured_model() or PlaceholderHandsModel()).predict(video)
    except Exception as exc:  # a model crash must become a review, not a failed job
        return CheckOutput(error=f"hands model failed: {exc}")
