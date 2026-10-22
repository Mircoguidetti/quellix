import cv2
import numpy as np

from quellix_eval.datasets.manifest import ClipRecord, TaskSpec
from quellix_eval.privacy_report import contact_sheet, privacy_breakdown
from quellix_eval.run import EngineResult


def clip(cid):
    return ClipRecord(clip_id=cid, source="s", license="synthetic", path="p", truth="accept",
                      labels_source="human", task=TaskSpec(description="d"))


def result(**privacy):
    return EngineResult({"checks": {"privacy": {"status": "fail", "measurements": {
        "faces": [], "documents": [], "screens": [], **privacy}}}})


def test_breakdown_counts_types_and_score_buckets():
    clips = [clip("a"), clip("b"), clip("c"), clip("a__face")]
    results = {
        "a": result(faces=[{"t_s": 1.0, "box": [0.1, 0.1, 0.05, 0.1], "score": 0.82},
                           {"t_s": 1.25, "box": [0.1, 0.1, 0.07, 0.1], "score": 0.97}]),
        "b": result(screens=[{"t_s": 3.0, "box": [0.2, 0.2, 0.3, 0.3], "score": 2.0}]),
        "c": result(),
        "a__face": result(faces=[{"t_s": 0.0, "box": [0, 0, 1, 1], "score": 0.9}]),
    }
    md = privacy_breakdown(results, clips)
    assert "3 originals had a privacy measurement" in md  # variants are not counted
    faces = next(line for line in md.splitlines() if line.startswith("| faces"))
    assert "| 1 | 2 |" in faces and "0.80-0.90: 1" in faces and ">= 0.95: 1" in faces
    assert "| screens | 1 | 1 |" in md and "`a` faces: first at 1.0s" in md


def test_breakdown_without_measurements_is_safe():
    md = privacy_breakdown({"a": EngineResult(None, error="x")}, [clip("a")])
    assert "0 originals had a privacy measurement" in md


def test_contact_sheet_tiles_original_frames_only(tmp_path):
    frames = tmp_path / "f"
    frames.mkdir()
    img = np.full((90, 160, 3), 80, np.uint8)
    for name in ("o1__faces__1.0", "o2__screens__2.5", "o1__face__faces__1.0"):  # last: a variant
        cv2.imwrite(str(frames / f"{name}.jpg"), img)
    n = contact_sheet(frames, tmp_path / "sheet.jpg", cols=2)
    assert n == 2 and cv2.imread(str(tmp_path / "sheet.jpg")) is not None


def test_contact_sheet_with_no_frames(tmp_path):
    (tmp_path / "f").mkdir()
    assert contact_sheet(tmp_path / "f", tmp_path / "s.jpg") == 0
