import json
from pathlib import Path

from quellix_worker.checks.task_baseline import TaskJudgement

from quellix_tasks.data import load_manifest
from quellix_tasks.teacher import label

from .conftest import TASK


class FakeJudge:
    name = "baseline:fake"

    def __init__(self, answers):
        self.answers = answers
        self.seen: list[Path] = []

    def judge(self, video_path, prompt, duration_s):
        self.seen.append(video_path)
        a = self.answers[video_path.stem]
        if isinstance(a, Exception):
            raise a
        return TaskJudgement(completed=a[0], confidence=a[1], cost_usd=0.01, model=self.name,
                             steps=({"name": "x", "t_s": 1.0},))


def _manifest(tmp_path, rows):
    m = tmp_path / "m.jsonl"
    m.write_text("".join(json.dumps({
        "clip_id": cid, "source": "src", "license": lic, "path": f"{cid}.mp4", "task": TASK,
        "truth": "accept", "checks": {}}) + "\n" for cid, lic in rows))
    return load_manifest(m)


def test_only_public_clips_go_to_the_teacher_and_only_confident_answers_label(tmp_path):
    clips = _manifest(tmp_path, [("a", "apache-2.0"), ("b", "cdla-permissive-2.0"),
                                 ("c", "customer-opt-in"), ("d", "apache-2.0"),
                                 ("e", "apache-2.0")])
    judge = FakeJudge({"a": (True, 0.95), "b": (False, 0.9), "d": (None, 0.2),
                       "e": RuntimeError("quota")})
    records, stats = label(clips, judge, min_confidence=0.8)
    assert [p.stem for p in judge.seen] == ["a", "b", "d", "e"]   # customer clip never sent
    assert stats == {"sent": 4, "labelled": 2, "unsure": 1, "not_sent": 1, "errors": 1,
                     "cost_usd": 0.03}
    by_id = {r["clip_id"]: r for r in records}
    assert by_id["a"]["checks"]["task_completed"] == "pass"
    assert by_id["b"]["truth"] == "reject" and by_id["b"]["labels_source"] == "baseline"
    assert json.loads(by_id["a"]["notes"])["steps"][0]["t_s"] == 1.0


def test_customer_clips_need_the_org_to_allow_external_models(tmp_path):
    clips = _manifest(tmp_path, [("c", "customer-opt-in")])
    judge = FakeJudge({"c": (True, 0.99)})
    records, _ = label(clips, judge, org_allows_external=True)
    assert len(records) == 1
