import numpy as np

from quellix_eval.viewpoint import data
from quellix_eval.viewpoint.extract import search_ids


def test_split_is_stable_and_roughly_balanced():
    groups = [f"g{i}" for i in range(400)]
    held = [data.split_of(g) == "held_out" for g in groups]
    assert data.split_of("g1") == data.split_of("g1")
    assert 0.3 < sum(held) / len(held) < 0.5


def test_features_round_trip(tmp_path):
    c = data.ClipFeatures("c1", "egocentric10k", "g", "first_person", "dev", 640, 360, 20.0,
                          [data.FrameFeat(0.0, [data.HandFeat("left", "full", 0.9,
                                                              [[0.1, 0.9]] * 9)],
                                          [[0.1, 0.1, 0.2, 0.2, 0.8]])],
                          [[0.01, 0.0, 0.5]])
    p = tmp_path / "f.jsonl.gz"
    data.save(p, [c])
    (back,) = data.load(p)
    assert back == c


def test_hand_feats_keep_the_chosen_landmarks():
    class Obs:
        def __init__(self, side, state):
            self.side, self.state, self.confidence = side, state, 0.8
            self.keypoints = np.arange(42, dtype=float).reshape(21, 2) / 100

    class FH:
        left, right = Obs("left", "full"), Obs("right", "absent")

    (h,) = data.hand_feats(FH())
    assert h.side == "left" and len(h.kp) == len(data.KEEP) and h.kp[1] == [0.08, 0.09]


def test_search_page_links():
    html = ('<a href="/video/woman-cooking-3195650/">a</a><a href="/video/woman-cooking-3195650/">'
            '<a href="https://www.pexels.com/video/pov-hands-7654321/">')
    assert search_ids(html) == [("woman-cooking", 3195650), ("pov-hands", 7654321)]


def test_hand_labels_applied_and_vetoes_dropped(tmp_path):
    def c(cid, src="pixabay:candidate"):
        return data.ClipFeatures(cid, src, cid, None, "dev")

    labels = tmp_path / "l.jsonl"
    labels.write_text(
        '{"clip_id": "pixabay_1", "label": "third_person", "labelled_by": "agent"}\n'
        '{"clip_id": "pixabay_2", "label": "exclude", "labelled_by": "agent"}\n'
        '{"clip_id": "pixabay_3", "label": "first_person", "labelled_by": "agent", '
        '"vetoed": true}\n')
    out = data.apply_labels([c("pixabay_1"), c("pixabay_2"), c("pixabay_3"), c("pixabay_4"),
                             c("ego", "egocentric10k")], labels)
    assert [(x.clip_id, x.label, x.source) for x in out] == [
        ("pixabay_1", "third_person", "pixabay:agent"), ("ego", None, "egocentric10k")]
