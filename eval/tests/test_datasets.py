import json

import pytest

from quellix_eval.datasets import egocentric10k, holoassist
from quellix_eval.datasets.manifest import load_manifest


def test_egocentric10k_with_mocks(tmp_path):
    seen = []

    def lister(repo, token, limit):
        seen.append((repo, token, limit))
        return ["a/clip1.mp4", "b/clip2.mp4"]

    def fetcher(repo, name, token, d):
        return d / name

    n = egocentric10k.build(tmp_path / "m.jsonl", tmp_path / "d", limit=2, token="t",
                            lister=lister, fetcher=fetcher)
    assert n == 2 and seen == [("builddotai/Egocentric-10K", "t", 2)]
    recs = load_manifest(tmp_path / "m.jsonl")
    assert {r.license for r in recs} == {"apache-2.0"} and {r.truth for r in recs} == {"accept"}


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
