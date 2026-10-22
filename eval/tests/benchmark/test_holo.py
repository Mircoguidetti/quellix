import io
import json
import random
import zipfile
from pathlib import Path

import numpy as np
import pytest

from quellix_eval.benchmark import handpose, holo
from quellix_eval.benchmark.remote_tar import Member


def act(a, b, correctness="Correct action"):
    return {"label": "Fine grained action", "start": a, "end": b, "type": "range",
            "attributes": {"Action Correctness": correctness, "Verb": "grab"}}


def coarse(a, b, sentence):
    return {"label": "Coarse grained action", "start": a, "end": b, "type": "range",
            "attributes": {"Action sentence": sentence}}


EVENTS = [coarse(0, 50, "A man opens the GoPro."), coarse(50, 100, "He changes the battery."),
          act(5, 20), act(25, 60), act(70, 90)]


def fake_cutter(calls):
    def cut(src: Path, dst: Path, a: float, b: float) -> float:
        calls.append((a, b))
        dst.parent.mkdir(parents=True, exist_ok=True)
        dst.write_bytes(b"x")
        return b - a
    return cut


@pytest.mark.parametrize("name,key", [
    ("z013-june-16-22-gopro", "gopro"), ("R046-13July-SmallPrinter", "printer_small"),
    ("z044-june-24-22-marius_assemble", "marius_assemble"), ("R012-7July-Nespresso", "nespresso"),
    ("z001-espresso", "espresso"), ("R110-5Aug-Navvis", "navvis"), ("odd-name", "other")])
def test_task_key(name, key):
    assert holo.task_key(name) == key


def test_load_annotations_accepts_both_shapes():
    as_list = [{"video_name": "a", "events": EVENTS}, {"video_name": "b", "events": []}]
    as_map = {"a": {"events": EVENTS}, "c": EVENTS}
    assert set(holo.load_annotations(as_list)) == {"a", "b"}
    assert holo.load_annotations(as_map)["c"] == EVENTS


def test_task_clips_full_and_cut_labels(tmp_path):
    calls: list = []
    recs = holo.task_clips("z013-june-16-22-gopro", EVENTS, tmp_path / "v.mp4", tmp_path,
                           fake_cutter(calls))
    full, cut = recs
    assert (full.truth, full.checks) == ("accept", {"task_completed": "pass"})
    assert (cut.truth, cut.checks) == ("reject", {"task_completed": "fail"})
    assert calls == [(32.0, 92.0), (20.0, 80.0)]   # 60 s ending 2 s after / halfway the last
    assert full.task.steps == ["A man opens the GoPro.", "He changes the battery."]
    assert full.task.description == holo.TASKS["gopro"]
    assert {full.license, full.source, full.labels_source} == {"cdla-permissive-2.0",
                                                               "holoassist", "human"}


def test_uncorrected_mistake_gets_no_completed_clip(tmp_path):
    events = [*EVENTS, act(91, 95, "Wrong action, not corrected")]
    recs = holo.task_clips("s", events, tmp_path / "v.mp4", tmp_path, fake_cutter([]))
    assert [r.truth for r in recs] == ["reject"]
    corrected = [*EVENTS, act(91, 95, "Wrong action, corrected by instructor")]
    assert len(holo.task_clips("s", corrected, tmp_path / "v", tmp_path, fake_cutter([]))) == 2


def test_hands_window_is_random_but_mostly_manipulation():
    acts = holo.fine_actions(EVENTS)
    for seed in range(20):
        a, b = holo.hands_window(acts, random.Random(seed))
        covered = sum(max(0, min(e, b) - max(s, a)) for s, e in acts)
        assert b - a == 20 and covered >= 10
    assert holo.hands_window([], random.Random(0)) is None


def test_hands_clip_label_from_pose(tmp_path):
    t = np.arange(0, 100, 0.5)
    all_visible = handpose.FrameVisibility(t, np.ones_like(t, bool), np.ones_like(t, bool))
    rec = holo.hands_clip("s", EVENTS, tmp_path / "v", all_visible, tmp_path,
                          random.Random(1), fake_cutter([]))
    assert rec.checks == {"hands_visible": "pass"} and rec.truth == "accept"
    assert json.loads(rec.notes)["both_visible_ratio"] == 1.0
    none = handpose.FrameVisibility(t, np.zeros_like(t, bool), np.ones_like(t, bool))
    rec = holo.hands_clip("s", EVENTS, tmp_path / "v", none, tmp_path, random.Random(1),
                          fake_cutter([]))
    assert rec.checks == {"hands_visible": "fail"} and rec.truth == "reject"


def test_pick_sessions_covers_every_task_first():
    names = [f"z{i:03d}-gopro" for i in range(10)] + ["R1-DSLR", "R2-Nespresso"]
    picked = holo.pick_sessions(names, 3, seed=1)
    assert {holo.task_key(s) for s in picked} == {"gopro", "dslr", "nespresso"}
    assert holo.pick_sessions(names, 3, seed=1) == picked          # deterministic
    assert len(holo.pick_sessions(names, 50, seed=1)) == 12


def test_member_for_and_splits():
    index = {n: Member(n, 0, 1) for n in (
        "data/z013-june-16-22-gopro/Export_py/Video_pitchshift.mp4",
        "data/z013-june-16-22-gopro-2/Export_py/Video_pitchshift.mp4",
        "z013-june-16-22-gopro/Export_py/Hands/Left_sync.txt")}
    m = holo.member_for(index, "z013-june-16-22-gopro", "Video_pitchshift.mp4")
    assert m.name == "data/z013-june-16-22-gopro/Export_py/Video_pitchshift.mp4"
    assert holo.member_for(index, "z013-june-16-22-gopro", "Hands/Left_sync.txt")
    assert holo.member_for(index, "nope", "Video_pitchshift.mp4") is None
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("val-v1_2.txt", "a\nb\n")
        z.writestr("test-v1_2.txt", "c\n")
    assert holo.load_splits(buf.getvalue()) == {"val": ["a", "b"], "test": ["c"]}


def test_remote_indexes_are_walked_once(tmp_path, monkeypatch):
    calls = []

    def fake_walk(reader, cache, keep):
        calls.append(reader.url)
        return {}

    monkeypatch.setattr(holo, "load_or_walk", fake_walk)
    r = holo.Remote(tmp_path)
    r.hands()
    r.hands()
    r.cams()
    assert calls == [holo.HANDS_TAR_URL, holo.CAM_TAR_URL]


def test_overlay_draws_projected_joints(tmp_path):
    from quellix_eval.defects import make_clean_clip, write_video

    c = make_clean_clip(n_frames=30, size=(96, 128), fps=10.0)
    video = tmp_path / "v.mp4"
    write_video(video, c.frames, c.fps)
    t = np.arange(30) / 10.0
    pts = np.tile(np.array([[50.0, 40.0]]), (30, 26, 1))
    vis = handpose.FrameVisibility(t, np.ones(30, bool), np.zeros(30, bool), pts,
                                   np.full_like(pts, np.nan), (128, 96))
    dst = tmp_path / "d" / "o.jpg"
    assert holo.overlay(video, vis, 1.5, dst, "s ratio=0.5")
    import cv2
    img = cv2.imread(str(dst))
    assert img.shape[:2] == (96, 128)
    b, g_, r = img[40, 50].astype(int)
    assert g_ > 150 and r < 100                       # green dot where the joint projects
    assert not holo.overlay(video, handpose.FrameVisibility(t, vis.left, vis.right), 1.0,
                            tmp_path / "x.jpg", "no points")
