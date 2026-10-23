"""The faces' second stage (#83): a face must still be a face when redrawn at other sizes."""

import json

import cv2
import numpy as np
import pytest

from quellix_worker import media
from quellix_worker.checks import privacy

from .clips import scene, write_clip
from .test_regressions_23 import needs_models

NO_REGIONS = type("N", (), {"detect": lambda self, rgb: []})()


def _clip(tmp_path):
    return media.decode(write_clip(tmp_path / "c.mp4", scene(2, 60, size=(320, 180)), fps=15))


class Faces:
    """One face box on every analysed frame, with a fixed score and verify value."""

    def __init__(self, verify, only_call=None):
        self.verify, self.only, self.n = verify, only_call, 0

    def detect(self, rgb):
        self.n += 1
        if self.only is not None and self.n != self.only:
            return []
        return [(0.1, 0.1, 0.15, 0.2, 0.86, self.verify)]


def run(video, faces):
    return privacy.run(video, faces=faces, documents=NO_REGIONS, screens=NO_REGIONS).measurements


def test_face_crop_is_square_centred_and_grey_past_the_edge():
    rgb = np.zeros((180, 320, 3), np.uint8)
    rgb[:] = (200, 10, 10)
    crop = privacy.face_crop(rgb, (0.0, 0.0, 0.1, 0.1), 64)  # a 32 px box in the corner
    assert crop.shape[:2] == (128, 128)                      # twice the box, box at 64 px
    assert tuple(crop[3, 3]) == (128, 128, 128)
    assert tuple(crop[-4, -4]) == (200, 10, 10)


def test_an_unverified_face_is_only_possible(tmp_path):
    m = run(_clip(tmp_path), Faces(verify=privacy.FACE_VERIFY_MIN - 0.01))
    assert m["faces"] == [] and m["faces_possible"]
    assert m["faces_possible"][0]["verify"] == pytest.approx(privacy.FACE_VERIFY_MIN - 0.01)
    json.dumps(m)


def test_a_verified_face_is_reported(tmp_path):
    m = run(_clip(tmp_path), Faces(verify=privacy.FACE_VERIFY_MIN))
    assert m["faces"] and not m["faces_possible"]


def test_a_clearly_verified_face_counts_on_a_single_frame(tmp_path):
    video = _clip(tmp_path)
    m = run(video, Faces(verify=privacy.FACE_SINGLE_FRAME_VERIFY, only_call=3))
    assert len(m["faces"]) == 1
    m = run(video, Faces(verify=privacy.FACE_SINGLE_FRAME_VERIFY - 0.01, only_call=3))
    assert m["faces"] == []                    # verified, but a lone frame: still a flicker


def test_detectors_without_verify_keep_the_old_rule(tmp_path):
    class Old:
        def detect(self, rgb):
            return [(0.1, 0.1, 0.15, 0.2, 0.86)]

    m = run(_clip(tmp_path), Old())
    assert m["faces"] and "verify" not in m["faces"][0]


@needs_models
def test_a_real_face_passes_the_scale_check_at_several_sizes():
    data = pytest.importorskip("skimage.data")
    a = data.astronaut()
    det = privacy.YuNetFaceDetector()
    for width in (480, 320):  # the face about 90 px and 60 px wide
        frame = cv2.resize(a, (width, width))
        faces = [f for f in det.detect(frame) if len(f) > 5]
        assert faces, f"no confident face at {width}"
        assert max(f[5] for f in faces) >= privacy.FACE_VERIFY_MIN


@needs_models
def test_a_textured_disc_is_not_verified():
    """A dark disc of 'coffee' with two light specks and a stick: the shape of the pestle false
    face. Whatever YuNet scores it, it must not pass the scale check."""
    rng = np.random.default_rng(3)
    frame = np.full((270, 480, 3), 40, np.uint8)
    frame += rng.integers(0, 30, frame.shape, dtype=np.uint8)
    cv2.circle(frame, (360, 120), 34, (150, 140, 130), -1)
    cv2.circle(frame, (360, 120), 28, (60, 35, 25), -1)
    for x, y in ((348, 110), (372, 112)):
        cv2.circle(frame, (x, y), 4, (220, 220, 210), -1)
    cv2.line(frame, (330, 150), (395, 105), (120, 90, 60), 4)
    det = privacy.YuNetFaceDetector()
    for f in det.detect(frame):
        if len(f) > 5:
            assert f[5] < privacy.FACE_VERIFY_MIN
