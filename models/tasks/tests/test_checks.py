import json

import numpy as np

from quellix_tasks import checks
from quellix_tasks.head import Head
from quellix_tasks.train import train

from .conftest import TASK
from .test_train import _dataset


def test_auc_and_confusion():
    y = np.array([1, 1, 0, 0])
    assert checks.auc(np.array([0.9, 0.8, 0.2, 0.1]), y) == 1.0
    assert checks.auc(np.array([0.1, 0.2, 0.8, 0.9]), y) == 0.0
    assert checks.auc(np.array([0.5, 0.5, 0.5, 0.5]), y) == 0.5
    c = checks.confusion(["accept", "review", "reject", "accept"], y)
    assert c["completed"] == {"accept": 1, "reject": 0, "review": 1}
    assert c["not_completed"] == {"accept": 1, "reject": 1, "review": 0}


def test_features_reproduce_the_head_they_trained_and_only_that_head():
    ds = _dataset()
    head, report = train(ds, folds=4, max_false_accept=0.0, min_reject_precision=0.95)
    s = report["settings"]
    assert checks.reproduce(ds, head, s)["ok"]
    other = _dataset(seed=7)
    assert not checks.reproduce(other, head, s)["ok"]          # different matrix: no match
    san = checks.real_head_sanity(ds, head, s)
    assert san["ok"] and san["oof_auc"] > 0.9
    assert san["oof_mean_p_completed"] > san["oof_mean_p_not_completed"]


def test_shuffled_labels_lose_the_signal():
    ds = _dataset(40)
    _, report = train(ds, folds=4)
    res = checks.shuffle_control(ds, report["settings"])
    assert res["permutations"] == checks.SHUFFLES
    assert 0.35 < res["oof_auc_mean"] < 0.65                   # the real data gives > 0.9
    assert checks.real_head_sanity(ds, train(ds, folds=4)[0], report["settings"])["oof_auc"] > 0.9


def test_serve_check_compares_route_probability_and_task_text(tmp_path):
    ds = _dataset(3)
    head, _ = train(ds, folds=3)
    ids = ["holo_task_a_full", "holo_task_a_cut"]
    ds.clip_ids[:2] = ids
    checks.save_features(ds, tmp_path / "f.json")
    head.save(tmp_path / "h.json")
    (tmp_path / "rub").mkdir()
    manifest = tmp_path / "m.jsonl"
    manifest.write_text("".join(json.dumps({
        "clip_id": c, "source": "holoassist", "license": "cdla-permissive-2.0",
        "path": f"{c}.mp4", "task": TASK, "truth": "accept",
        "checks": {"task_completed": "pass"}}) + "\n" for c in ids))
    rows = []
    for i, c in enumerate(ids):
        (tmp_path / "rub" / f"{c}.rubric.json").write_text(json.dumps({"task": TASK}))
        rows.append({"clip_id": c, "p_completed": round(float(head.proba(ds.x[i])[0]), 4)})
    (tmp_path / "s.json").write_text(json.dumps({"rows": rows}))
    (tmp_path / "fc.json").write_text(json.dumps({"ok": True}))
    args = ["serve", "--features", str(tmp_path / "f.json"), "--head", str(tmp_path / "h.json"),
            "--train-manifest", str(manifest), "--scored", str(tmp_path / "s.json"),
            "--rubrics", str(tmp_path / "rub"), "--features-check", str(tmp_path / "fc.json"),
            "--out", str(tmp_path / "out.json")]
    assert checks.main(args) == 0
    out = json.loads((tmp_path / "out.json").read_text())
    assert out["passed"] and out["serve"]["max_abs_diff"] < 1e-4

    rows[0]["p_completed"] += 0.01                              # a train/serve mismatch
    (tmp_path / "s.json").write_text(json.dumps({"rows": rows}))
    assert checks.main(args) == 1
    rows[0]["p_completed"] -= 0.01
    (tmp_path / "s.json").write_text(json.dumps({"rows": rows}))
    (tmp_path / "rub" / f"{ids[1]}.rubric.json").write_text(
        json.dumps({"task": {**TASK, "steps": ["other"]}}))     # different task text
    assert checks.main(args) == 1
    assert isinstance(Head.load(tmp_path / "h.json"), Head)
