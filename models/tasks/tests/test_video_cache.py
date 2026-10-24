import json

import numpy as np

from quellix_tasks import video
from quellix_tasks.data import load_manifest
from quellix_tasks.train import build_dataset, cache_key

from .conftest import TASK, FakeEncoder, colour_frame


def _count_decodes(monkeypatch):
    calls = []

    def fake(path, sample_fps=video.SAMPLE_FPS):
        calls.append(path)
        return [colour_frame("red"), colour_frame("green"), colour_frame("blue")], np.arange(3.0)

    monkeypatch.setattr(video, "sample_frames", fake)
    return calls


def test_same_key_at_two_paths_hits_the_same_entry(tmp_path, monkeypatch):
    calls = _count_decodes(monkeypatch)
    a = tmp_path / "run1" / "clip.mp4"
    a.parent.mkdir()
    a.write_bytes(b"x" * 10)
    emb1, t1 = video.cached_embeddings(a, FakeEncoder(), tmp_path / "c", key="clip|1.0|61.0")
    b = tmp_path / "run2" / "clip.mp4"          # other path; does not even exist
    emb2, t2 = video.cached_embeddings(b, FakeEncoder(), tmp_path / "c", key="clip|1.0|61.0")
    assert calls == [a]
    assert np.allclose(emb1, emb2) and np.allclose(t1, t2)
    assert len(list((tmp_path / "c").glob("*.npz"))) == 1


def test_different_key_or_encoder_or_fps_is_a_different_entry(tmp_path, monkeypatch):
    calls = _count_decodes(monkeypatch)
    f = tmp_path / "clip.mp4"
    f.write_bytes(b"x")
    video.cached_embeddings(f, FakeEncoder(), tmp_path / "c", key="a")
    video.cached_embeddings(f, FakeEncoder(), tmp_path / "c", key="b")
    video.cached_embeddings(f, FakeEncoder(), tmp_path / "c", sample_fps=2.0, key="a")
    assert len(calls) == 3


def test_without_key_the_path_size_and_mtime_still_decide(tmp_path, monkeypatch):
    calls = _count_decodes(monkeypatch)
    f = tmp_path / "clip.mp4"
    f.write_bytes(b"x")
    video.cached_embeddings(f, FakeEncoder(), tmp_path / "c")
    video.cached_embeddings(f, FakeEncoder(), tmp_path / "c")
    assert len(calls) == 1
    f.write_bytes(b"xy")                          # size changed: new entry
    video.cached_embeddings(f, FakeEncoder(), tmp_path / "c")
    assert len(calls) == 2


def _manifest(path, clip_dir, notes):
    rec = {"clip_id": "holo_task_S1_full", "source": "holoassist", "license": "cdla-permissive-2.0",
           "path": str(clip_dir / "holo_task_S1_full.mp4"), "task": TASK, "truth": "accept",
           "checks": {"task_completed": "pass"}, "notes": notes}
    path.write_text(json.dumps(rec) + "\n")
    return load_manifest(path)


def test_cache_key_is_clip_id_plus_window_never_the_file(tmp_path):
    notes = "HoloAssist S1 [150.6, 210.6] s: ends after the last annotated action"
    (clip,) = _manifest(tmp_path / "m.jsonl", tmp_path, notes)
    assert cache_key(clip) == "holo_task_S1_full|150.6|210.6"
    (nowin,) = _manifest(tmp_path / "n.jsonl", tmp_path, "no window here")
    assert cache_key(nowin) is None


def test_build_dataset_reuses_embeddings_of_a_rebuilt_clip(tmp_path, monkeypatch):
    calls = _count_decodes(monkeypatch)
    notes = "HoloAssist S1 [0.0, 60.0] s: ends halfway"
    for run in ("run1", "run2"):                   # the same clip, cut again in another place
        d = tmp_path / run
        d.mkdir()
        (d / "holo_task_S1_full.mp4").write_bytes(run.encode() * 100)   # different size
        clips = _manifest(d / "m.jsonl", d, notes)
        ds = build_dataset(clips, FakeEncoder(), tmp_path / "cache")
        assert ds.clip_ids == ["holo_task_S1_full"]
    assert len(calls) == 1
