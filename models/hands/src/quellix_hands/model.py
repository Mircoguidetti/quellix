"""Worker-facing API.

    model = HandsModel()                       # MediaPipe detector + heuristic contact
    m = model.measure(frames, timestamps)      # -> hands_visible measurements
    model.model_id                             # "hands@0.1.0"

``frames``: RGB uint8 arrays (H x W x 3), e.g. the worker's sampled ``Frame.rgb``.
``timestamps``: seconds from the start of the video, same length, increasing.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import replace
from typing import Any

import numpy as np

from .aggregate import aggregate
from .contact import ContactEstimator, HeuristicContact, segments_from_contact
from .infer import Detector, InferConfig, infer_frame
from .types import FrameHands

MODEL_VERSION = "0.1.0"


class HandsModel:
    def __init__(self, detector: Detector | None = None, contact: ContactEstimator | None = None,
                 config: InferConfig | None = None, *, max_gap_s: float = 1.0,
                 min_segment_s: float = 0.5) -> None:
        if detector is None:
            from .detectors import MediaPipeDetector

            detector = MediaPipeDetector()
        self.detector = detector
        self.contact = contact or HeuristicContact()
        self.config = config or InferConfig()
        self.max_gap_s = max_gap_s
        self.min_segment_s = min_segment_s
        self.model_id = f"hands@{MODEL_VERSION}"
        self.name = self.model_id  # matches the worker's HandsModel protocol attribute

    def frames(self, frames: Sequence[np.ndarray], timestamps: Sequence[float]) -> list[FrameHands]:
        """Per-frame results with contact filled in (useful for debugging and evaluation)."""
        if len(frames) != len(timestamps):
            raise ValueError("frames and timestamps must have the same length")
        per_frame = [infer_frame(rgb, t, self.detector, self.config)
                     for rgb, t in zip(frames, timestamps, strict=True)]
        contact = self.contact.estimate(per_frame)
        return [replace(f, contact=c) for f, c in zip(per_frame, contact, strict=True)]

    def measure(self, frames: Sequence[np.ndarray], timestamps: Sequence[float]) -> dict[str, Any]:
        per_frame = self.frames(frames, timestamps)
        segments = segments_from_contact([f.t_s for f in per_frame], [f.contact for f in per_frame],
                                         self.max_gap_s, self.min_segment_s)
        m = aggregate(per_frame, segments)
        m["detector"] = self.detector.name
        m["contact_model"] = self.contact.name
        m["margin"] = self.config.margin
        return m

    def measure_video(self, video: Any) -> dict[str, Any]:
        """Duck-typed on the worker's ``DecodedVideo`` (``.frames`` of ``.t_s`` / ``.rgb``),
        so this package does not import the worker."""
        frames = list(video.frames)
        return self.measure([f.rgb for f in frames], [f.t_s for f in frames])


def without_nulls(measurements: dict[str, Any]) -> dict[str, Any]:
    """Drop null ratios. The current worker rubric treats a missing key as "could not be
    measured" (review) but would crash on ``float(None)``; use this until it handles null."""
    return {k: v for k, v in measurements.items() if v is not None}
