import json

import numpy as np
from test_pixabay import FakeNet, hit

from quellix_eval import privacy_faces as pf
from quellix_eval.defects import write_video


def shot(n: int = 16) -> list[np.ndarray]:
    rng = np.random.default_rng(1)
    return [np.clip(rng.normal(100, 30, (270, 480, 3)), 0, 255).astype(np.uint8) for _ in range(n)]


class FakeDetector:
    def detect(self, rgb):
        return [{"box": [0.0, 0.0, 0.1, 0.15], "score": 0.85, "landmarks": [0.0] * 10,
                 "worker": "confident"},
                {"box": [0.5, 0.5, 0.05, 0.05], "score": 0.35, "landmarks": [0.0] * 10,
                 "worker": "below"}]


def test_split_is_stable_and_about_sixty_forty():
    ids = [f"pixabay_{i}" for i in range(2000)]
    dev = sum(pf.split_of(i) == "dev" for i in ids)
    assert 0.55 < dev / len(ids) < 0.65
    assert pf.split_of("pexels_6693828") == pf.split_of("pexels_6693828")


def test_crop_is_square_twice_the_box_and_padded_at_the_edge():
    rgb = np.zeros((270, 480, 3), np.uint8)
    rgb[:, :] = (200, 10, 10)
    crop, scale = pf._crop_for(rgb, [0.0, 0.0, 0.1, 0.1], 64)   # a 48 px box in the corner
    assert crop.shape[0] == crop.shape[1] == round(96 * 64 / 48)
    assert abs(scale - 64 / 48) < 1e-6
    assert tuple(crop[2, 2]) == (128, 128, 128)          # outside the frame: grey padding
    assert tuple(crop[-3, -3]) == (200, 10, 10)          # inside the frame


def test_known_clips_are_fetched_again_by_id():
    net = FakeNet([hit(5)])
    rows = [{"clip_id": "pixabay_5", "source": "pixabay", "page_url": "u", "proposed": "face",
             "group": "frontal", "query": "q"}, {"clip_id": "pexels_1", "source": "pexels"},
            {"clip_id": "pixabay_6", "source": "pixabay", "page_url": "u", "proposed": "face",
             "group": "frontal"}]
    out = pf.pixabay_known(net, "K", rows)
    assert [(c.clip_id, h.pixabay_id) for c, h in out] == [("pixabay_5", 5)]  # 6: not found


def test_pixabay_clips_keep_query_label_and_skip_repeats():
    net = FakeNet([hit(1), hit(2)])
    out = pf.pixabay_clips(net, "K", 2, [("woman talking", "face", "frontal"),
                                         ("marble", "no_face", "worktop")])
    assert [(c.clip_id, c.proposed, c.group) for c, _ in out] == [
        ("pixabay_1", "face", "frontal"), ("pixabay_2", "face", "frontal")]  # 2nd query: repeats


def test_pexels_clips_mark_the_countertop_face():
    clips = {c.clip_id: c for c, _ in pf.pexels_face_clips()}
    assert clips["pexels_5592524"].proposed == "face"
    assert clips["pexels_6693828"].proposed == "no_face"
    assert clips["pexels_6693828"].group == "first-person"


def test_run_records_features_sheets_and_manifest(tmp_path):
    clip = tmp_path / "c.mp4"
    write_video(clip, shot(), 8)
    items = [(pf.FaceClip("pixabay_1", "pixabay", "Pixabay Content License", "u", "face",
                          "frontal", "q"), None),
             (pf.FaceClip("pixabay_2", "pixabay", "Pixabay Content License", "u", "no_face",
                          "worktop", "q"), None)]
    scores = iter(range(1000))

    def scorer(crop):
        return round(next(scores) / 1000, 3)

    def fetch(c, src):
        if c.clip_id == "pixabay_2":
            raise RuntimeError("HTTP 404")
        return clip

    out = pf.run(items, fetch, tmp_path, FakeDetector(), scorer, overrides={"pixabay_1": "drop"})
    ok, bad = out
    strong = [d for d in ok.detections if d["score"] >= pf.FEATURE_MIN_SCORE]
    weak = [d for d in ok.detections if d["score"] < pf.FEATURE_MIN_SCORE]
    assert strong and weak and ok.frames == len(strong)
    assert set(strong[0]["scale_scores"]) == {str(p) for p in pf.FACE_SIZES}
    assert "flip_score" in strong[0] and "scale_scores" not in weak[0]
    assert ok.sheet == "sheet-01.jpg" and (tmp_path / "sheet-01.jpg").exists()
    assert bad.error == "RuntimeError: HTTP 404"
    lines = [json.loads(x) for x in pf.manifest_lines(out)]
    assert lines[0]["clip_id"] == "pixabay_1" and "detections" not in lines[0]
    md = pf.render_sheets(out, "{IMAGE_BASE}", "test")
    assert "![sheet-01.jpg]({IMAGE_BASE}sheet-01.jpg)" in md and "pixabay_2 (RuntimeError" in md
    assert pf.final_label(ok, {"pixabay_1": "drop"}) == "drop"
    assert ok.crops == "crops/pixabay_1.jpg" and (tmp_path / ok.crops).exists()
    assert "sheet-01" not in pf.render_sheets(out, "", "t", only_new={"pixabay_9"}).split(
        "every sheet")[1]
    dump = pf.features_dump(out)
    assert all(d["score"] >= 0.45 for d in dump[0]["detections"])
    assert dump[0]["n_detections_below"] == len(weak)
