"""Detector backends. v0: MediaPipe Hand Landmarker (Apache-2.0, see LICENSES.md).

``mediapipe`` is an optional dependency (``quellix-hands[mediapipe]``) and needs ``libEGL.so.1``
(Debian/Ubuntu ``libegl1``) at runtime, even on CPU.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

import numpy as np

from .types import RawHand, Side
from .weights import default_path


class MediaPipeDetector:
    """Wraps ``mediapipe.tasks.vision.HandLandmarker`` in IMAGE mode (frames are sparse samples,
    so no tracking state between them).

    MediaPipe's handedness assumes a mirrored (selfie) image. Egocentric cameras are not
    mirrored, so by default the labels are swapped to give the wearer's own left/right.
    """

    name = "mediapipe-hand_landmarker@float16-1"

    def __init__(self, model_path: str | Path | None = None, *, mirrored: bool = False,
                 min_detection_confidence: float = 0.5, min_presence_confidence: float = 0.5,
                 num_hands: int = 2) -> None:
        try:
            import mediapipe as mp
            from mediapipe.tasks.python import BaseOptions, vision
        except ImportError as exc:  # pragma: no cover - exercised only without the extra
            raise RuntimeError("install quellix-hands[mediapipe] to use MediaPipeDetector") from exc
        path = Path(model_path) if model_path else default_path()
        if not path.is_file():
            raise FileNotFoundError(
                f"{path} not found; run `python -m quellix_hands.weights download`")
        self._mp = mp
        self._mirrored = mirrored
        opts = vision.HandLandmarkerOptions(
            base_options=BaseOptions(model_asset_path=str(path)),
            running_mode=vision.RunningMode.IMAGE,
            num_hands=num_hands,
            min_hand_detection_confidence=min_detection_confidence,
            min_hand_presence_confidence=min_presence_confidence,
        )
        self._landmarker: Any = vision.HandLandmarker.create_from_options(opts)

    def _side(self, label: str) -> Side:
        side: Side = "left" if label.lower() == "left" else "right"
        if self._mirrored:
            return side
        return "right" if side == "left" else "left"

    def detect(self, rgb: np.ndarray) -> list[RawHand]:
        img = self._mp.Image(image_format=self._mp.ImageFormat.SRGB,
                             data=np.ascontiguousarray(rgb, dtype=np.uint8))
        result = self._landmarker.detect(img)
        hands: list[RawHand] = []
        for lms, handed in zip(result.hand_landmarks, result.handedness, strict=True):
            kp = np.array([[p.x, p.y] for p in lms], dtype=float)
            best = handed[0]
            hands.append(RawHand(self._side(best.category_name), float(best.score), kp))
        return hands

    def close(self) -> None:
        self._landmarker.close()

    def __enter__(self) -> MediaPipeDetector:
        return self

    def __exit__(self, *exc: object) -> None:
        self.close()
