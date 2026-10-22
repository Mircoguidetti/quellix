"""Privacy recall on overlays over real photographs (scikit-image sample images), and the
cost guard: the text detector never runs on frames without a candidate (issue #55)."""

import cv2
import numpy as np
import pytest

from quellix_worker import media
from quellix_worker.checks import privacy

from .clips import write_clip
from .test_privacy_overlays import EMPTY, document, screen
from .test_regressions_23 import needs_models

data = pytest.importorskip("skimage.data")
pytestmark = needs_models

# photographs / textures with no face, document or screen in them
BACKGROUNDS = ["chelsea", "coffee", "rocket", "brick", "grass", "gravel", "moon"]


def photo(name, size=(640, 360)):
    im = getattr(data, name)()
    if im.ndim == 2:
        im = np.stack([im] * 3, -1)
    im = im[..., :3]
    h, w = im.shape[:2]
    s = max(size[0] / w, size[1] / h)
    im = cv2.resize(im, (int(w * s) + 1, int(h * s) + 1))
    return np.ascontiguousarray(im[: size[1], : size[0]])


def real_face(frame, k=0):
    a = data.astronaut()
    face = a[15:140, 170:300]  # a real face (NASA astronaut portrait, public domain)
    g = frame.copy()
    h, w = g.shape[:2]
    fw = int(w * 0.12 * (1 + 0.3 * (k % 3)))
    f = cv2.resize(face, (fw, int(fw * face.shape[0] / face.shape[1])))
    x, y = int(w * (0.1 + 0.25 * (k % 3))), int(h * 0.15)
    g[y: y + f.shape[0], x: x + f.shape[1]] = f
    return g


def measure(tmp_path, frame, name):
    clip = write_clip(tmp_path / f"{name}.mp4", [frame] * 16, fps=8)
    return privacy.run(media.decode(clip)).measurements


@pytest.mark.parametrize("bg", BACKGROUNDS)
def test_clean_photos_have_no_detections(tmp_path, bg):
    assert measure(tmp_path, photo(bg), bg) == EMPTY


@pytest.mark.parametrize("bg", BACKGROUNDS)
def test_document_overlay_is_found_on_any_background(tmp_path, bg):
    m = measure(tmp_path, document(photo(bg)), f"doc_{bg}")
    assert len(m["documents"]) >= 2 and m["screens"] == []


@pytest.mark.parametrize("bg", BACKGROUNDS)
def test_screen_overlay_is_found_on_any_background(tmp_path, bg):
    m = measure(tmp_path, screen(photo(bg)), f"scr_{bg}")
    assert len(m["screens"]) >= 2 and m["documents"] == []


@pytest.mark.parametrize("bg", BACKGROUNDS)
@pytest.mark.parametrize("k", [0, 1, 2])
def test_real_face_overlay_is_found(tmp_path, bg, k):
    m = measure(tmp_path, real_face(photo(bg), k), f"face_{bg}{k}")
    assert len(m["faces"]) >= 2
    assert all(d["score"] >= privacy.FACE_CONFIDENT_SCORE for d in m["faces"])


def test_text_detector_does_not_run_on_frames_without_candidates(tmp_path, monkeypatch):
    calls = []
    real = privacy.RegionAnalyzer._text_lines

    def counting(self, rgb):
        calls.append(rgb.shape)
        return real(self, rgb)

    monkeypatch.setattr(privacy.RegionAnalyzer, "_text_lines", counting)
    measure(tmp_path, photo("chelsea"), "clean_calls")
    assert calls == []  # clean frame: no rectangle candidates, no OCR
    measure(tmp_path, screen(photo("chelsea")), "screen_calls")
    assert calls  # a candidate triggers it, on a crop, never the whole frame
    assert all(h * w < 480 * 270 for h, w, _ in calls)
