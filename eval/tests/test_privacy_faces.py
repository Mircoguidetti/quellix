import json
from urllib.parse import parse_qs, urlparse

import numpy as np

from quellix_eval import privacy_faces as pf
from quellix_eval.defects import write_video


def hit(i):
    return {"id": i, "pageURL": f"https://pixabay.com/videos/x-{i}/", "tags": "face",
            "duration": 12,
            "videos": {"small": {"url": f"https://cdn/{i}.mp4", "width": 640, "height": 360}}}


class FakeNet:
    """Pixabay API: every search returns all hits; an id lookup returns that hit only."""

    def __init__(self, hits):
        self.hits = hits

    def get(self, url, headers=None):
        q = parse_qs(urlparse(url).query)
        if "id" in q:
            return json.dumps({"hits": [h for h in self.hits
                                        if str(h["id"]) == q["id"][0]]}).encode()
        return json.dumps({"hits": self.hits}).encode()


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


class VerifyFaces:
    """A confident face on every frame; its scale-check value depends on the clip."""

    def __init__(self, verify):
        self.verify = verify

    def detect(self, rgb):
        return [(0.1, 0.1, 0.15, 0.2, 0.86, self.verify)]


def test_without_verify_is_the_old_rule():
    w = pf.WithoutVerify(VerifyFaces(0.2))
    assert w.detect(None) == [(0.1, 0.1, 0.15, 0.2, 0.86)]


def test_score_rows_before_after_and_report(tmp_path):
    clip = tmp_path / "c.mp4"
    write_video(clip, shot(), 8)
    bowl = pf.FaceClip("pexels_6693828", "pexels", "Pexels License", "u", "no_face",
                       "first-person", "pestle", split="heldout")
    face = pf.FaceClip("pexels_5592524", "pexels", "Pexels License", "u", "face", "turned",
                       "countertop", split="dev")
    gone = pf.FaceClip("pixabay_9", "pixabay", "Pixabay Content License", "u", "face",
                       "frontal", split="dev")
    rows = []
    for c, v in ((bowl, 0.3), (face, 0.9)):
        rows += pf.score_rows([(c, None)], lambda c, s: clip, VerifyFaces(v), {})
    rows += pf.score_rows([(gone, None)], lambda c, s: clip, VerifyFaces(0.9),
                          {"pixabay_9": "drop"})
    assert [(r.clip_id, r.before, r.after) for r in rows] == [
        ("pexels_6693828", True, False), ("pexels_5592524", True, True)]
    assert rows[0].before_first_s == 0.0 and rows[0].after_first_s is None
    assert pf.rates(rows, "before") == ("1.00 [0.21-1.00] (1/1)", "0.00 [0.00-0.79] (0/1)")
    md = pf.render_score(rows, "test", "{IMAGE_BASE}")
    assert "| heldout | after | 0.00 [0.00-0.79] (0/1) | n/a |" in md
    assert "| pexels_6693828, pestle (founder's clip) | no_face | face at 0.0 s | no face |" in md
    assert "Errors after the change (0)" in md
