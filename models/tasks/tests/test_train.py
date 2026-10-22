import json

import numpy as np
import pytest

from quellix_tasks.data import check_license, load_manifest
from quellix_tasks.features import FEATURE_NAMES
from quellix_tasks.head import Head, fit_logistic, fit_thresholds
from quellix_tasks.metrics import decisions, reject_metrics
from quellix_tasks.model import TaskModel
from quellix_tasks.train import Dataset, group_folds, train

from .conftest import COMPLETE, CUT, MISSING, TASK, FakeEncoder, frames_for


def _dataset(n_groups: int = 30, seed: int = 0) -> Dataset:
    """Pairs like HoloAssist: each recording gives a complete clip and a cut / missing one."""
    rng = np.random.default_rng(seed)
    enc = FakeEncoder(seed)
    model = TaskModel(enc)
    xs, ys, groups = [], [], []
    for g in range(n_groups):
        bad = CUT if g % 2 else MISSING
        for seq, y in ((COMPLETE, 1.0), (bad, 0.0)):
            # jitter segment lengths so clips differ
            seq = [(c, max(1, n + int(rng.integers(-1, 2)))) for c, n in seq]
            frames, times = frames_for(seq)
            analysis, _ = model.analyse_embeddings(TASK, enc.embed_images(frames), times)
            xs.append(analysis.features)
            ys.append(y)
            groups.append(f"rec{g}")
    return Dataset(np.stack(xs), np.array(ys), np.array(groups), [str(i) for i in range(len(ys))])


def test_training_separates_and_reports_rejection_metrics():
    ds = _dataset()
    head, report = train(ds, folds=4, max_false_accept=0.0, min_reject_precision=0.95)
    assert report["clips"] == 60 and report["not_completed"] == 30
    held = report["held_out"]
    assert held["false_accept_rate"] == 0.0           # doubt never accepted
    assert held["reject_recall"] > 0.5
    assert held["reject_precision"] is None or held["reject_precision"] >= 0.9
    assert 0 <= head.reject_at < head.accept_at <= 1
    assert head.version == "trained-n60"
    p = head.proba(ds.x)
    assert p[ds.y == 1].mean() > p[ds.y == 0].mean()


def test_group_folds_never_split_a_recording():
    groups = np.array(["a", "a", "b", "b", "c", "c", "d"])
    folds = group_folds(groups, 3, seed=0)
    assert np.all(np.sum(folds, axis=0) == 1)       # each clip in exactly one fold
    for f in folds:
        for g in np.unique(groups[f]):
            assert f[groups == g].all()


def test_fit_thresholds_caps_false_accepts_and_keeps_rejections_precise():
    p = np.array([0.05, 0.1, 0.2, 0.4, 0.6, 0.7, 0.8, 0.9, 0.95, 0.99])
    y = np.array([0, 0, 0, 1, 0, 1, 1, 1, 1, 1])
    reject_at, accept_at = fit_thresholds(p, y, max_false_accept=0.0, min_reject_precision=1.0)
    assert accept_at == pytest.approx(0.7)    # 0.6 is a not-completed clip: stays below accept
    assert reject_at == pytest.approx(0.2)
    pred = decisions(p, reject_at, accept_at)
    m = reject_metrics(pred, y.astype(bool))
    assert m.false_accept_rate == 0.0 and m.reject_precision == 1.0
    assert m.base_reject_rate == pytest.approx(0.4) and m.review_rate == pytest.approx(0.2)


def test_fit_logistic_learns_a_separable_feature():
    rng = np.random.default_rng(0)
    x = rng.normal(size=(200, len(FEATURE_NAMES)))
    y = (x[:, 0] > 0).astype(float)
    head = fit_logistic(x, y)
    assert ((head.proba(x) > 0.5) == (y == 1)).mean() > 0.95
    assert isinstance(head, Head)


def test_training_needs_both_classes():
    ds = _dataset(4)
    keep = ds.y == 1
    with pytest.raises(ValueError):
        train(Dataset(ds.x[keep], ds.y[keep], ds.groups[keep], []))


def _write(path, records):
    path.write_text("".join(json.dumps(r) + "\n" for r in records))


def _record(clip_id, license_="cdla-permissive-2.0", source="holoassist", label="pass"):
    return {"clip_id": clip_id, "source": source, "license": license_, "path": f"{clip_id}.mp4",
            "task": TASK, "truth": "accept" if label == "pass" else "reject",
            "checks": {"task_completed": label}}


def test_manifest_labels_groups_and_relative_paths(tmp_path):
    m = tmp_path / "m.jsonl"
    _write(m, [_record("holo_s1_full"), _record("holo_s1_cut", label="fail"),
               {**_record("x"), "checks": {}}])
    clips = load_manifest(m)
    assert [c.completed for c in clips] == [True, False, None]
    assert clips[0].group == clips[1].group == "holo_s1"
    assert clips[0].path == tmp_path / "holo_s1_full.mp4"


@pytest.mark.parametrize("source,license_", [
    ("epic-kitchens-100", "cc-by-nc-4.0"), ("ego4d", "apache-2.0"),
    ("holoassist", "cc-by-nc-4.0"), ("somewhere", "unknown")])
def test_non_commercial_or_unknown_licenses_are_refused(tmp_path, source, license_):
    with pytest.raises(ValueError):
        check_license(source, license_)
    m = tmp_path / "m.jsonl"
    _write(m, [_record("a", license_, source)])
    with pytest.raises(ValueError, match="m.jsonl:1"):
        load_manifest(m)
