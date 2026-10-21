import json
from pathlib import Path

import pytest

from quellix_eval.datasets import egocentric10k, holoassist
from quellix_eval.datasets.manifest import load_manifest


def _tar_with_clips(path, clip_paths, prefix="factory001_worker001"):
    import tarfile

    with tarfile.open(path, "w") as tar:
        for i, cp in enumerate(clip_paths):
            key = f"{prefix}_{i:05d}"
            meta = path.parent / f"{key}.json"
            meta.write_text(json.dumps({"video_index": i}))
            tar.add(meta, arcname=f"{key}.json")
            tar.add(cp, arcname=f"{key}.mp4")
    return path


def test_egocentric10k_streams_shards_and_transcodes(tmp_path):
    from quellix_eval.defects.generate import make_clean_clip, write_video

    clean = make_clean_clip(seed=1)
    srcs = []
    for i in range(3):
        p = tmp_path / f"src{i}.mp4"
        write_video(p, clean.frames, clean.fps)
        srcs.append(p)
    shards = ["factory_002/workers/worker_001/factory002_worker001_part00.tar",
              "factory_001/workers/worker_002/factory001_worker002_part00.tar",
              "factory_001/workers/worker_001/factory001_worker001_part00.tar",
              "factory_001/workers/worker_001/intrinsics.json"]
    opened = []

    def opener(repo, name, token):
        opened.append(name)
        prefix = Path(name).stem.removesuffix("_part00")
        return open(_tar_with_clips(tmp_path / f"{prefix}.tar", srcs, prefix), "rb")

    n = egocentric10k.build(tmp_path / "m.jsonl", tmp_path / "d", clips=3, per_shard=2,
                            seconds=1.0, width=64, fps=5, token="t",
                            lister=lambda repo, token: [s for s in shards if s.endswith(".tar")],
                            opener=opener)
    assert n == 3
    # one shard per factory, first worker first
    assert opened == ["factory_001/workers/worker_001/factory001_worker001_part00.tar",
                      "factory_002/workers/worker_001/factory002_worker001_part00.tar"]
    recs = load_manifest(tmp_path / "m.jsonl")
    assert {r.license for r in recs} == {"apache-2.0"} and {r.truth for r in recs} == {"accept"}
    assert all(r.labels_source == "baseline" for r in recs)
    import av
    with av.open(recs[0].path) as c:
        s = c.streams.video[0]
        assert s.width == 64
    assert recs[0].duration_s <= 1.2


def test_pick_shards_one_per_factory():
    shards = ["f2/w/a.tar", "f1/w/b.tar", "f1/w/a.tar", "f3/w/a.tar"]
    assert egocentric10k.pick_shards(shards, 2) == ["f1/w/a.tar", "f2/w/a.tar"]


def test_egocentric10k_needs_token(tmp_path, monkeypatch):
    monkeypatch.delenv("HF_TOKEN", raising=False)
    with pytest.raises(RuntimeError, match="HF_TOKEN"):
        egocentric10k.build(tmp_path / "m.jsonl", tmp_path, lister=lambda *a: [])


def test_holoassist_pairs(tmp_path):
    (tmp_path / "v").mkdir()
    (tmp_path / "v" / "s1.mp4").write_bytes(b"x")
    ann = [
        {"video_name": "s1", "taskType": "assemble",
         "events": [{"label": "Fine grained action", "start": 0, "end": 4,
                     "attributes": {"Verb": "grab"}},
                    {"label": "Fine grained action", "start": 4, "end": 10,
                     "attributes": {"Verb": "press"}},
                    {"label": "Conversation", "start": 0, "end": 30}]},
        {"video_name": "missing",
         "events": [{"label": "Fine grained action", "start": 0, "end": 1}]},
    ]
    (tmp_path / "a.json").write_text(json.dumps(ann))
    cuts = []
    n = holoassist.build(tmp_path / "a.json", tmp_path / "v", tmp_path / "m.jsonl",
                         tmp_path / "cut", cutter=lambda s, d, t: cuts.append(t))
    assert n == 2 and cuts == [7.0]    # halfway through the last action (4..10)
    full, cut = load_manifest(tmp_path / "m.jsonl")
    assert (full.truth, full.checks) == ("accept", {"task_completed": "pass"})
    assert (cut.truth, cut.checks) == ("reject", {"task_completed": "fail"})
    assert cut.license == "cdla-permissive-2.0" and full.task.steps == ["grab", "press"]
