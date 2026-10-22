import json
from pathlib import Path

import av
import numpy as np
import pytest

from quellix_tasks.__main__ import main, task_only
from quellix_tasks.features import FEATURE_NAMES
from quellix_tasks.head import Head

from .conftest import COLOURS, COMPLETE, TASK, FakeEncoder

RUBRIC = json.loads((Path(__file__).parents[3] / "packages" / "contracts" / "examples"
                     / "rubric.load_dishwasher.json").read_text())


def _video(path: Path, seq, fps: int = 4) -> Path:
    with av.open(str(path), "w") as out:
        stream = out.add_stream("libx264", rate=fps)
        stream.width = stream.height = 64
        stream.pix_fmt = "yuv420p"
        for colour, seconds in seq:
            for _ in range(seconds * fps):
                img = np.full((64, 64, 3), COLOURS[colour], dtype=np.uint8)
                out.mux(stream.encode(av.VideoFrame.from_ndarray(img, format="rgb24")))
        out.mux(stream.encode())
    return path


@pytest.fixture
def rubric_file(tmp_path):
    p = tmp_path / "rubric.json"
    p.write_text(json.dumps({**RUBRIC, "task": TASK}))
    return p


def _head(tmp_path, bias):
    p = tmp_path / "head.json"
    Head([0.0] * len(FEATURE_NAMES), bias, accept_at=0.9, reject_at=0.1).save(p)
    return p


def _run(capsys, argv):
    code = main(argv, encoder=FakeEncoder())
    return code, capsys.readouterr().out


def test_check_prints_a_valid_task_only_decision(tmp_path, capsys, rubric_file):
    video = _video(tmp_path / "v.mp4", COMPLETE)
    report = tmp_path / "report.json"
    code, out = _run(capsys, ["check", str(video), "--rubric", str(rubric_file),
                              "--video-id", "v1", "--report", str(report),
                              "--head", str(_head(tmp_path, 5.0))])
    assert code == 0
    d = json.loads(out)
    assert d["video_id"] == "v1" and d["decision"] == "accept"
    tc = d["checks"]["task_completed"]
    assert tc["status"] == "pass" and tc["model"].startswith("tasks@")
    assert [s["name"] for s in tc["measurements"]["steps"]] == TASK["steps"]
    assert all(d["checks"][c]["status"] == "skipped" for c in d["checks"] if c != "task_completed")
    assert json.loads(report.read_text())["decision"] == d


def test_not_completed_rejects_and_doubt_goes_to_review(tmp_path, capsys, rubric_file):
    video = _video(tmp_path / "v.mp4", COMPLETE)
    _, out = _run(capsys, ["check", str(video), "--rubric", str(rubric_file),
                           "--head", str(_head(tmp_path, -5.0))])
    assert json.loads(out)["decision"] == "reject"
    _, out = _run(capsys, ["check", str(video), "--rubric", str(rubric_file),
                           "--head", str(_head(tmp_path, 0.0))])
    d = json.loads(out)
    assert d["decision"] == "review"
    assert d["checks"]["task_completed"]["status"] == "uncertain"


def test_undecodable_video_goes_to_review(tmp_path, capsys, rubric_file):
    bad = tmp_path / "bad.mp4"
    bad.write_bytes(b"not a video")
    code, out = _run(capsys, ["check", str(bad), "--rubric", str(rubric_file)])
    assert code == 0 and json.loads(out)["decision"] == "review"


def test_invalid_input_exits_2(tmp_path, capsys, rubric_file):
    assert _run(capsys, ["check", str(tmp_path / "nope.mp4"), "--rubric", str(rubric_file)])[0] == 2
    video = _video(tmp_path / "v.mp4", [("red", 1)])
    assert _run(capsys, ["check", str(video), "--rubric", str(tmp_path / "missing.json")])[0] == 2


def test_task_only_disables_every_other_check():
    r = task_only({"checks": {"task_completed": {"enabled": False, "min_confidence": 0.8},
                              "privacy": {"faces": "reject"}}})
    assert r["checks"]["task_completed"] == {"enabled": True, "min_confidence": 0.8}
    assert r["checks"]["privacy"] == {"faces": "reject", "enabled": False}
    assert r["checks"]["hands_visible"] == {"enabled": False}
