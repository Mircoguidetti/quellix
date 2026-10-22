"""Privacy on the eval's synthetic overlays (documents, screens, faces) and on clean frames."""

import cv2
import numpy as np
import pytest

from quellix_worker import media
from quellix_worker.checks import privacy

from .clips import scene, write_clip
from .test_regressions_23 import needs_models


def background(seed=1, size=(640, 360)):
    rng = np.random.default_rng(seed)
    w, h = size
    return cv2.resize(rng.integers(40, 200, (18, 32, 3), dtype=np.uint8), (w, h),
                      interpolation=cv2.INTER_CUBIC)


def document(f):  # same geometry as quellix_eval overlay_document
    g = f.copy()
    h, w = g.shape[:2]
    x0, y0, x1, y1 = int(w * 0.55), int(h * 0.1), int(w * 0.95), int(h * 0.7)
    cv2.rectangle(g, (x0, y0), (x1, y1), (245, 245, 240), -1)
    for y in range(y0 + 6, y1 - 4, 8):
        cv2.line(g, (x0 + 4, y), (x1 - 4, y), (30, 30, 30), 1)
    return g


def screen(f):  # same geometry as quellix_eval overlay_screen
    g = f.copy()
    h, w = g.shape[:2]
    x0, y0, x1, y1 = int(w * 0.05), int(h * 0.05), int(w * 0.45), int(h * 0.4)
    cv2.rectangle(g, (x0, y0), (x1, y1), (15, 15, 20), -1)
    cv2.rectangle(g, (x0, y0), (x1, y1), (180, 180, 180), 2)
    cv2.putText(g, "LOGIN", (x0 + 6, y0 + 18), cv2.FONT_HERSHEY_SIMPLEX, 0.45, (80, 255, 120), 1)
    cv2.rectangle(g, (x0 + 6, y0 + 28), (x1 - 6, y0 + 40), (60, 120, 255), -1)
    return g


def face_frame():
    g = background()
    h, w = g.shape[:2]
    c, r = (int(w * 0.8), int(h * 0.3)), h // 5
    cv2.circle(g, c, r, (230, 190, 160), -1)
    for dx in (-r // 3, r // 3):
        cv2.circle(g, (c[0] + dx, c[1] - r // 5), max(1, r // 8), (20, 20, 20), -1)
    cv2.ellipse(g, (c[0], c[1] + r // 3), (r // 3, r // 6), 0, 0, 180, (120, 40, 40), 2)
    return g


def run(tmp_path, frames, name):
    return privacy.run(media.decode(write_clip(tmp_path / f"{name}.mp4", frames, fps=10))
                       ).measurements


@needs_models
def test_document_overlay_is_found(tmp_path):
    m = run(tmp_path, [document(background()) for _ in range(30)], "doc")
    assert len(m["documents"]) >= 8 and not m["screens"]


@needs_models
def test_screen_overlay_is_found(tmp_path):
    m = run(tmp_path, [screen(background()) for _ in range(30)], "scr")
    assert len(m["screens"]) >= 8 and not m["documents"]


@needs_models
def test_cartoon_face_is_not_a_face_for_yunet(tmp_path):
    """The eval's face overlay is a flat cartoon (circle, dots, arc): a real face detector
    scores it ~0.1, far below the 0.7 threshold. Lowering the threshold to catch it would flag
    real footage; the eval should overlay a real face image instead. Documented, not 'fixed'."""
    m = run(tmp_path, [face_frame() for _ in range(10)], "cartoon")
    assert m["faces"] == []


@needs_models
@pytest.mark.parametrize("seed", [1, 2, 3])
def test_clean_frames_have_no_detections(tmp_path, seed):
    m = run(tmp_path, scene(seed, 40, size=(320, 180)), f"clean{seed}")
    assert m == {"faces": [], "documents": [], "screens": []}


@needs_models
def test_bright_blob_without_lines_is_not_a_document(tmp_path):
    g = background()
    cv2.rectangle(g, (300, 40), (600, 250), (245, 245, 240), -1)
    m = run(tmp_path, [g] * 20, "blob")
    assert m["documents"] == []


@needs_models
def test_printed_text_is_a_document(tmp_path):
    g = background()
    cv2.rectangle(g, (280, 30), (620, 300), (245, 245, 240), -1)
    for i in range(9):
        cv2.putText(g, f"Inspection report line {i} ok 4521", (292, 62 + i * 28),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.55, (20, 20, 20), 1)
    m = run(tmp_path, [g] * 20, "text")
    assert len(m["documents"]) >= 5
