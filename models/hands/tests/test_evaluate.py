import json

import pytest
from synthetic import ColorBlobDetector, draw_frame

from quellix_hands import HandsModel
from quellix_hands.evaluate import evaluate, markdown

av = pytest.importorskip("av")

FPS = 4


def _write_clip(path, boxes):
    with av.open(str(path), "w") as c:
        s = c.add_stream("png", rate=FPS)  # lossless, so blob colours survive
        s.width, s.height, s.pix_fmt = 160, 120, "rgb24"
        for b in boxes:
            frame = av.VideoFrame.from_ndarray(draw_frame(b), format="rgb24")
            for packet in s.encode(frame):
                c.mux(packet)
        for packet in s.encode():
            c.mux(packet)


class AllContact:
    name = "all@test"

    def estimate(self, frames):
        return [{"left": "object", "right": "object"} for _ in frames]


def test_evaluate_on_a_generated_clip(tmp_path):
    inside = {"left": (0.2, 0.5, 0.4, 0.9), "right": (0.6, 0.5, 0.8, 0.9)}
    cut = {"left": (0.2, 0.5, 0.4, 0.9), "right": (0.85, 0.5, 1.3, 0.9)}
    boxes = [inside, inside, cut, cut, inside, {"left": inside["left"]}]
    _write_clip(tmp_path / "c1.avi", boxes)
    (tmp_path / "m.jsonl").write_text(json.dumps({"clip_id": "c1", "path": "c1.avi"}) + "\n")
    truth = [("full", "full"), ("full", "full"), ("full", "truncated"), ("full", "truncated"),
             ("full", "full"), ("full", "absent")]
    labels = {"clip_id": "c1", "frames": [
        {"t_s": i / FPS, "left": lt, "right": rt, "manipulation": True}
        for i, (lt, rt) in enumerate(truth)]}
    (tmp_path / "l.jsonl").write_text(json.dumps(labels) + "\n")

    model = HandsModel(detector=ColorBlobDetector(), contact=AllContact())
    s = evaluate(model, tmp_path / "m.jsonl", tmp_path / "l.jsonl", root=tmp_path).summary()
    assert s["hand_frames"] == 12
    assert s["state_accuracy"] == 1.0
    assert s["truncation_precision"] == 1.0 and s["truncation_recall"] == 1.0
    assert s["ratio_mae"]["ratio_both_whole"] == 0.0
    assert s["ratio_mae"]["ratio_both_manipulation"] == 0.0
    assert "truncation precision / recall: 1.0 / 1.0" in markdown(s, model.model_id)


def test_labels_for_an_unknown_clip(tmp_path):
    (tmp_path / "m.jsonl").write_text("")
    (tmp_path / "l.jsonl").write_text(json.dumps({"clip_id": "x", "frames": []}) + "\n")
    with pytest.raises(ValueError):
        evaluate(HandsModel(detector=ColorBlobDetector()), tmp_path / "m.jsonl",
                 tmp_path / "l.jsonl")
