"""Blur on plain backgrounds (#22): a sharp shot over a plain worktop is not blurry.

Scenes are built from scikit-image sample photos (not from any scored clip): a textured object
filling a small part of a large plain surface, light (white worktop) or dark (marble).
"""

import cv2
import numpy as np
import pytest

from quellix_worker import media
from quellix_worker.checks import technical

from .clips import write_clip

data = pytest.importorskip("skimage.data")
H, W = 270, 480


def _gray(img: np.ndarray) -> np.ndarray:
    return cv2.cvtColor(img[..., :3], cv2.COLOR_RGB2GRAY) if img.ndim == 3 else img


def _jpeg(g: np.ndarray) -> np.ndarray:
    return cv2.imdecode(cv2.imencode(".jpg", g, [cv2.IMWRITE_JPEG_QUALITY, 60])[1], 0)


def on_plain(photo: np.ndarray, bg: int, share: float = 0.25, seed: int = 0) -> np.ndarray:
    """The photo pasted (soft edge) on a plain surface with sensor noise, `share` of the width."""
    rng = np.random.default_rng(seed)
    plain = np.full((H, W), bg, np.float32) + rng.normal(0, 1.5, (H, W))
    h, w = int(H * share * 1.5), int(W * share)
    y, x = H - h - 20, W // 2 - w // 2
    canvas = plain.copy()
    canvas[y:y + h, x:x + w] = cv2.resize(_gray(photo), (w, h), interpolation=cv2.INTER_AREA)
    alpha = np.zeros((H, W), np.float32)
    alpha[y:y + h, x:x + w] = 1
    alpha = cv2.GaussianBlur(alpha, (0, 0), 2)
    return np.clip(alpha * canvas + (1 - alpha) * plain, 0, 255).astype(np.uint8)


def motion(g: np.ndarray, k: int = 15) -> np.ndarray:
    kernel = np.zeros((k, k), np.float32)
    kernel[k // 2, :] = 1 / k
    return cv2.filter2D(g, -1, kernel)


def defocus(g: np.ndarray, sigma: float = 2.5) -> np.ndarray:
    return cv2.GaussianBlur(g, (0, 0), sigma)


def old_rule_blurry(g: np.ndarray) -> bool:
    return float(cv2.Laplacian(g, cv2.CV_64F).var()) < 60.0


PHOTOS = ["coffee", "astronaut", "chelsea", "coins", "rocket"]
SURFACES = {"white worktop": 205, "dark marble": 55}


@pytest.mark.parametrize("surface", SURFACES)
@pytest.mark.parametrize("name", PHOTOS)
def test_sharp_object_on_a_plain_surface_is_not_blurry(name, surface):
    frame = _jpeg(on_plain(getattr(data, name)(), SURFACES[surface]))
    assert not technical.is_blurry(frame)


@pytest.mark.parametrize("surface", SURFACES)
@pytest.mark.parametrize("name", PHOTOS)
def test_motion_blur_and_defocus_are_still_caught(name, surface):
    sharp = on_plain(getattr(data, name)(), SURFACES[surface])
    assert technical.is_blurry(_jpeg(motion(sharp)))
    assert technical.is_blurry(_jpeg(defocus(sharp)))


def test_vertical_motion_blur_is_caught_too():
    sharp = _jpeg(on_plain(data.astronaut(), 205))
    assert technical.is_blurry(np.ascontiguousarray(motion(sharp.T).T))


def test_the_old_rule_called_a_sharp_plain_shot_blurry():
    """The regression this fixes: a small sharp subject on a large white surface."""
    frame = _jpeg(on_plain(data.chelsea(), 205, share=0.2))
    assert old_rule_blurry(frame)
    assert not technical.is_blurry(frame)


def test_a_frame_with_no_texture_cannot_be_judged_and_is_not_blurry():
    flat = np.full((H, W), 200, np.uint8)
    assert technical.sharpness(flat) is None
    assert not technical.is_blurry(flat)


def test_whole_frame_photos_sharp_vs_blurred():
    for name in PHOTOS:
        g = _jpeg(cv2.resize(_gray(getattr(data, name)()), (W, H), interpolation=cv2.INTER_AREA))
        assert not technical.is_blurry(g), name
        assert technical.is_blurry(_jpeg(motion(g, 19))), name


def test_measurements_on_a_clip(tmp_path):
    sharp = cv2.cvtColor(on_plain(data.coffee(), 205), cv2.COLOR_GRAY2RGB)
    flat = np.full_like(sharp, 230)
    frames = [sharp] * 30 + [flat] * 30
    m = technical.run(media.decode(write_clip(tmp_path / "c.mp4", frames, fps=15))).measurements
    assert m["blur_ratio"] == 0
    assert m["blur_unmeasurable_ratio"] == pytest.approx(0.5, abs=0.1)
    assert m["sharpness_median"] > technical.BLUR_SHARPNESS
