import json
from dataclasses import asdict
from types import SimpleNamespace

import cv2
import numpy as np
import pytest
from quellix_worker.checks import privacy

from quellix_eval import privacy_diagnosis as pdg
from quellix_eval.defects import write_video


def shot(n: int = 24) -> list[np.ndarray]:
    rng = np.random.default_rng(0)
    return [np.clip(rng.normal(90, 25, (270, 480, 3)), 0, 255).astype(np.uint8) for _ in range(n)]


class FakeFaces:
    """A 'face' in the top-left corner on every frame (strong), and a weak one on odd calls."""

    def __init__(self):
        self.n = 0

    def detect(self, rgb):
        self.n += 1
        out = [{"box": [0.1, 0.1, 0.1, 0.15], "score": 0.91,
                "landmarks": [0.12, 0.14, 0.17, 0.14, 0.15, 0.17, 0.13, 0.2, 0.17, 0.2],
                "worker": pdg.worker_class(0.91, 0.1)}]
        if self.n % 2:
            out.append({"box": [0.6, 0.5, 0.03, 0.05], "score": 0.42, "landmarks": [],
                        "worker": pdg.worker_class(0.42, 0.03)})
        return out


def test_worker_class_mirrors_the_worker_rule():
    assert pdg.worker_class(privacy.FACE_CONFIDENT_SCORE, privacy.FACE_CONFIDENT_SHARE) == \
        "confident"
    assert pdg.worker_class(0.95, privacy.FACE_CONFIDENT_SHARE - 0.001) == "possible"
    assert pdg.worker_class(privacy.FACE_MIN_SCORE, privacy.FACE_MIN_SHARE) == "possible"
    assert pdg.worker_class(0.59, 0.5) == "below"
    assert pdg.worker_class(0.95, privacy.FACE_MIN_SHARE - 0.001) == "below"


def test_raw_yunet_returns_dicts_on_a_frame_without_a_face():
    try:
        det = pdg.RawYuNet()
    except Exception as e:  # noqa: BLE001 - weights not downloadable here
        pytest.skip(f"YuNet weights unavailable: {e}")
    out = det.detect(np.full((270, 480, 3), 128, np.uint8))
    assert out == [] or all({"box", "score", "landmarks", "worker"} <= set(d) for d in out)


def test_run_with_a_fake_download_and_detector(tmp_path, monkeypatch):
    clip = tmp_path / "c.mp4"
    write_video(clip, shot(), 12)

    class Steady:  # what the worker's own detector sees (box, score)
        def detect(self, rgb):
            return [(0.1, 0.1, 0.1, 0.15, 0.91)]

    monkeypatch.setattr(privacy, "YuNetFaceDetector", Steady)
    picks = [SimpleNamespace(clip_id="pexels_1", task="Pestle"),
             SimpleNamespace(clip_id="pexels_2", task="Broken")]

    def fetch(pick):
        if pick.clip_id == "pexels_2":
            raise RuntimeError("HTTP 403")
        return clip

    rows = pdg.run_clips(picks, fetch, tmp_path, FakeFaces())
    ok, bad = rows
    assert ok.error is None and ok.frames > 0 and ok.width == 480
    assert ok.count("confident") == ok.frames and ok.count("below") == (ok.frames + 1) // 2
    assert ok.worker_faces and ok.worker_faces[0]["t_s"] == 0.0
    assert 1 <= len(ok.images) <= pdg.FRAMES_PER_CLIP
    img = cv2.imread(str(tmp_path / ok.images[0]))
    assert img.shape[1] == pdg.FRAME_WIDTH and img.shape[0] > 270  # header + frame + zooms
    assert bad.error == "RuntimeError: HTTP 403" and not bad.images
    md = pdg.render(rows, "{IMAGE_BASE}", "test")
    assert "| pexels_1 (Pestle) |" in md and "failed: RuntimeError: HTTP 403" in md
    assert f"]({{IMAGE_BASE}}{ok.images[0]})" in md
    json.dumps([asdict(r) for r in rows])


def test_pick_times_prefers_strong_frames_and_keeps_the_first_confident():
    r = pdg.ClipResult("c", "n")
    r.detections = [{"t_s": float(t), "score": s, "worker": w} for t, s, w in
                    [(0, 0.81, "confident"), (1, 0.99, "possible"), (2, 0.98, "possible"),
                     (3, 0.97, "possible"), (4, 0.96, "possible"), (5, 0.4, "below")]]
    assert pdg.pick_times(r, 4) == [0.0, 1.0, 2.0, 3.0]
    r.detections = [{"t_s": 7.0, "score": 0.45, "worker": "below"}]
    assert pdg.pick_times(r) == []
