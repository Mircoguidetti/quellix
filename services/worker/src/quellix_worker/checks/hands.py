"""Hand visibility. The real model lives in models/hands (another agent)."""

from __future__ import annotations

from typing import Protocol

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


def run(video: DecodedVideo, model: HandsModel | None = None) -> CheckOutput:
    try:
        return (model or PlaceholderHandsModel()).predict(video)
    except Exception as exc:  # a model crash must become a review, not a failed job
        return CheckOutput(error=f"hands model failed: {exc}")
