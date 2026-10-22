"""Real inference with the MediaPipe weights. Skipped unless ``mediapipe`` is installed, the weights
are present (``python -m quellix_hands.weights download``) and libEGL is available."""

import numpy as np
import pytest

from quellix_hands import weights
from quellix_hands.types import RawHand

pytest.importorskip("mediapipe")


@pytest.fixture(scope="module")
def detector():
    if not weights.is_valid(weights.default_path()):
        pytest.skip("hand_landmarker.task not downloaded")
    from quellix_hands.detectors import MediaPipeDetector

    try:
        det = MediaPipeDetector()
    except OSError as exc:  # e.g. libEGL.so.1 missing
        pytest.skip(f"mediapipe runtime unavailable: {exc}")
    yield det
    det.close()


def test_runs_on_a_generated_image(detector):
    rng = np.random.default_rng(0)
    img = rng.integers(0, 255, size=(240, 320, 3), dtype=np.uint8)
    hands = detector.detect(img)
    assert isinstance(hands, list)
    for h in hands:
        assert isinstance(h, RawHand) and h.keypoints is not None and h.keypoints.shape == (21, 2)


def test_hands_model_end_to_end(detector):
    from quellix_hands import HandsModel

    frames = [np.full((240, 320, 3), 100, dtype=np.uint8) for _ in range(4)]
    m = HandsModel(detector=detector).measure(frames, [0.0, 0.25, 0.5, 0.75])
    assert m["ratio_both_whole"] == 0.0  # no hands in a flat grey frame
    assert m["manipulation_detected"] is False
