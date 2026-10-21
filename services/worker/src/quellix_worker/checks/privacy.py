"""Privacy: faces (YuNet) and a pluggable detector for documents and screens."""

from __future__ import annotations

import hashlib
import os
import urllib.request
from pathlib import Path
from typing import Any, Protocol

import cv2
import numpy as np

from ..media import DecodedVideo
from ..rubric import CheckOutput

MODEL = "privacy:yunet-2023mar"

# YuNet (opencv_zoo, MIT). The weights are stored in Git LFS; they are fetched on first
# use into QUELLIX_MODEL_DIR (default ~/.cache/quellix) or read from QUELLIX_YUNET_PATH.
YUNET_FILENAME = "face_detection_yunet_2023mar.onnx"
# Pinned to an opencv_zoo commit; the file is checked against its sha256 after download.
YUNET_COMMIT = "48b10fa505aeb51fbd127fc60a5c660040e823b7"
YUNET_SHA256 = "8f2383e4dd3cfbb4553ea8718107fc0423210dc964f9f4280604804ed2552fa4"
YUNET_URL = (
    f"https://media.githubusercontent.com/media/opencv/opencv_zoo/{YUNET_COMMIT}/"
    f"models/face_detection_yunet/{YUNET_FILENAME}"
)
FACE_SCORE_THRESHOLD = 0.7
MIN_FACE_SHARE = 0.02  # ignore faces narrower than 2% of the frame width (far background)


class RegionDetector(Protocol):
    """Finds readable documents or screens in one RGB frame; returns boxes (x, y, w, h) as
    fractions of the frame, in [0, 1]."""

    def detect(self, rgb: np.ndarray) -> list[tuple[float, float, float, float]]: ...


class NoRegionDetector:
    """TODO: no licensed text-region detector is wired in yet (documents and screens)."""

    def detect(self, rgb: np.ndarray) -> list[tuple[float, float, float, float]]:
        return []


def yunet_path() -> Path:
    explicit = os.environ.get("QUELLIX_YUNET_PATH")
    if explicit:
        return Path(explicit)
    cache = Path(os.environ.get("QUELLIX_MODEL_DIR", Path.home() / ".cache" / "quellix"))
    target = cache / YUNET_FILENAME
    if not target.exists():
        cache.mkdir(parents=True, exist_ok=True)
        tmp = target.with_suffix(".part")
        urllib.request.urlretrieve(YUNET_URL, tmp)  # noqa: S310 (fixed https URL)
        digest = hashlib.sha256(tmp.read_bytes()).hexdigest()
        if digest != YUNET_SHA256:
            tmp.unlink()
            raise RuntimeError(f"YuNet weights have an unexpected sha256 ({digest})")
        tmp.rename(target)
    return target


class YuNetFaceDetector:
    def __init__(self, model_path: str | Path | None = None) -> None:
        self._path = str(model_path or yunet_path())
        self._detector: Any = None

    def detect(self, rgb: np.ndarray) -> list[tuple[float, float, float, float]]:
        h, w = rgb.shape[:2]
        if self._detector is None:
            self._detector = cv2.FaceDetectorYN.create(
                self._path, "", (w, h), FACE_SCORE_THRESHOLD, 0.3, 5000
            )
        self._detector.setInputSize((w, h))
        _, faces = self._detector.detect(cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR))
        if faces is None:
            return []
        boxes = [(f[0] / w, f[1] / h, f[2] / w, f[3] / h) for f in faces]
        return [b for b in boxes if b[2] >= MIN_FACE_SHARE]


def _detections(frames, detector) -> list[dict[str, Any]]:
    out = []
    for f in frames:
        for x, y, w, h in detector.detect(f.rgb):
            out.append({"t_s": f.t_s, "box": [round(v, 4) for v in (x, y, w, h)]})
    return out


def run(
    video: DecodedVideo,
    faces: Any | None = None,
    documents: RegionDetector | None = None,
    screens: RegionDetector | None = None,
) -> CheckOutput:
    try:
        face_detector = faces or YuNetFaceDetector()
        result = {
            "faces": _detections(video.frames, face_detector),
            "documents": _detections(video.frames, documents or NoRegionDetector()),
            "screens": _detections(video.frames, screens or NoRegionDetector()),
        }
    except Exception as exc:  # missing weights, bad model: review, never silent pass
        return CheckOutput(error=f"privacy detector unavailable: {exc}")
    return CheckOutput(measurements=result, model=MODEL)
