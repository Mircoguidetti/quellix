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


class QuellixHandsAdapter:
    """Wraps ``quellix_hands.HandsModel`` as the worker's ``HandsModel``."""

    def __init__(self, model: Any) -> None:
        self._model = model
        self.name = str(model.model_id)

    def predict(self, video: DecodedVideo) -> CheckOutput:
        return CheckOutput(measurements=for_rubric(self._model.measure_video(video)),
                           model=self.name)


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
