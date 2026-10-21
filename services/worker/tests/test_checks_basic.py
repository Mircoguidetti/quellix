import numpy as np
import pytest

from quellix_worker import media
from quellix_worker.checks import framing, hands, privacy, technical
from quellix_worker.rubric import CheckOutput

from .clips import scene, write_clip


@pytest.fixture(scope="module")
def good(tmp_path_factory):
    return write_clip(tmp_path_factory.mktemp("c") / "good.mp4", scene(1, 60))


def test_decode_metadata_and_sampling(good):
    v = media.decode(good, sample_fps=2)
    assert v.info.decodable and (v.info.width, v.info.height) == (160, 120)
    assert v.info.duration_s == pytest.approx(6.0, abs=0.2)
    assert 11 <= len(v.frames) <= 13
    assert v.frames[1].t_s == pytest.approx(0.5, abs=0.11)


def test_unreadable_file(tmp_path):
    bad = tmp_path / "bad.mp4"
    bad.write_bytes(b"not a video at all")
    v = media.decode(bad)
    assert not v.info.decodable
    out = technical.run(v)
    assert out.measurements == {"decodable": False}


def test_technical_good_clip(good):
    m = technical.run(media.decode(good)).measurements
    assert m["decodable"] and m["blur_ratio"] == 0 and m["bad_exposure_ratio"] == 0


def test_technical_blur_and_exposure(tmp_path):
    frames = [cv2_blur(f) for f in scene(2, 30)]
    m = technical.run(media.decode(write_clip(tmp_path / "b.mp4", frames))).measurements
    assert m["blur_ratio"] == 1.0
    dark = [(f * 0.1).astype(np.uint8) for f in scene(3, 30)]
    m = technical.run(media.decode(write_clip(tmp_path / "d.mp4", dark))).measurements
    assert m["bad_exposure_ratio"] == 1.0


def cv2_blur(f):
    import cv2

    return cv2.GaussianBlur(f, (0, 0), 6)


def test_framing_stable_vs_shaky(tmp_path):
    base = scene(4, 1)[0]
    still = [base.copy() for _ in range(30)]
    m = framing.run(media.decode(write_clip(tmp_path / "s.mp4", still))).measurements
    assert m["unstable_ratio"] == 0 and m["off_target_ratio"] == 0
    rng = np.random.default_rng(0)
    shaky = [np.roll(base, (int(rng.integers(-40, 40)), int(rng.integers(-60, 60))), (0, 1))
             for _ in range(30)]
    m = framing.run(media.decode(write_clip(tmp_path / "k.mp4", shaky))).measurements
    assert m["unstable_ratio"] > 0.5
    blank = [np.full_like(base, 128) for _ in range(30)]
    m = framing.run(media.decode(write_clip(tmp_path / "w.mp4", blank))).measurements
    assert m["off_target_ratio"] == 1.0


def test_hands_placeholder_never_measures(good):
    out = hands.run(media.decode(good))
    assert out.measurements is None and out.error == "hands model not configured"


class FakeFaces:
    def detect(self, rgb):
        return [(0.1, 0.1, 0.2, 0.2)]


def test_privacy_with_fake_detector(good):
    out = privacy.run(media.decode(good), faces=FakeFaces())
    assert out.measurements["documents"] == []
    assert len(out.measurements["faces"]) > 0 and "t_s" in out.measurements["faces"][0]


def test_privacy_missing_weights_is_error(good, monkeypatch, tmp_path):
    monkeypatch.setenv("QUELLIX_YUNET_PATH", str(tmp_path / "missing.onnx"))
    out = privacy.run(media.decode(good))
    assert isinstance(out, CheckOutput) and out.error
