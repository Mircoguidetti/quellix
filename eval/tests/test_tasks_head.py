import json
import sys

from quellix_eval import tasks_head as th
from quellix_eval.datasets.manifest import ClipRecord, TaskSpec, write_manifest


def _events(last=(10.0, 20.0), wrong=False):
    ev = [{"label": "Fine grained action", "start": 1.0, "end": 5.0},
          {"label": "Fine grained action", "start": last[0], "end": last[1]}]
    if wrong:
        ev.append({"label": "Fine grained action", "start": 6.0, "end": 8.0,
                   "attributes": {"Action Correctness": "Wrong action, not corrected"}})
    return ev


def test_expected_ids_follow_task_clips_rules():
    ann = {"R1-gopro": _events(), "R2-gopro": _events(wrong=True),
           "R3-gopro": [{"label": "Coarse grained action", "start": 0, "end": 3}],
           "R4-other": _events()}
    splits = {"val": ["R1-gopro", "R2-gopro", "R3-gopro", "missing"], "train": ["R4-other"]}
    ids = th.expected_task_ids(ann, splits, "val", 10, 64)
    assert sorted(ids) == ["holo_task_R1-gopro_cut", "holo_task_R1-gopro_full",
                           "holo_task_R2-gopro_cut"]
    assert th.expected_task_ids(ann, splits, "train", 10, 64) == [
        "holo_task_R4-other_full", "holo_task_R4-other_cut"]


def test_compare_ids_reports_every_difference():
    base = {"clips": {"a": "accept", "b": "reject"}}
    assert th.compare_ids(["b", "a"], base)["equal"]
    r = th.compare_ids(["a", "c"], base)
    assert not r["equal"] and r["only_found"] == ["c"] and r["only_baseline"] == ["b"]
    assert not th.compare_ids(["a", "a", "b"], base)["equal"]


def test_precision_at_recall_takes_ties_together():
    rows = [{"truth": "reject", "p_completed": p} for p in (0.1, 0.2, 0.3)]
    rows += [{"truth": "accept", "p_completed": p} for p in (0.3, 0.8, 0.9)]
    cut, prec, rec = th.precision_at_recall(rows, 1.0)
    assert cut == 0.3 and (prec.k, prec.n) == (3, 4) and (rec.k, rec.n) == (3, 3)
    assert th.precision_at_recall(rows, 0.3)[0] == 0.1
    assert th.precision_at_recall([{"truth": "accept", "p_completed": 0.5}], 0.5) is None


def test_sizing_uses_measured_throughput():
    rep = {"train_sessions": 10, "train": {"clips": 20}, "timings_s": {"train_s": 200.0,
           "setup_s": 600.0}, "build": {"clip_build_s": 100.0}}
    s = th.sizing(rep)
    # per session: 10 s build + 2 clips * 10 s = 30 s; (0.85 * 12600 - 600) / 30 = 337
    assert s["suggested_train_sessions"] == 337
    assert th.sizing({"train_sessions": 10}) is None


FAKE = """
import json, sys
vid = sys.argv[sys.argv.index("--video-id") + 1]
p = 0.05 if vid.endswith("_cut") else 0.97
dec = "reject" if p < 0.1 else "accept"
json.dump({"decision": dec, "checks": {"task_completed": {"status": "pass",
    "measurements": {"p_completed": p, "completed": p > 0.5, "missing_steps": ["x"]}}}},
    sys.stdout)
"""


def _recs(tmp_path):
    out = []
    for sid in ("s1", "s2"):
        for kind, truth in (("full", "accept"), ("cut", "reject")):
            f = tmp_path / f"{sid}_{kind}.mp4"
            f.write_bytes(b"x")
            out.append(ClipRecord(clip_id=f"holo_task_{sid}_{kind}", source="holoassist",
                                  license="cdla-permissive-2.0", path=str(f),
                                  task=TaskSpec(description="d"), truth=truth,
                                  checks={"task_completed": "pass" if kind == "full" else "fail"}))
    return out


def test_score_keeps_p_completed_through_run_worker(tmp_path):
    fake = tmp_path / "fake.py"
    fake.write_text(FAKE)
    head = tmp_path / "head.json"
    head.write_text(json.dumps({"version": "v", "reject_at": 0.1, "accept_at": 0.9}))
    write_manifest(_recs(tmp_path), tmp_path / "m.jsonl")
    out = tmp_path / "out"
    rc = th.main(["score", "--manifest", str(tmp_path / "m.jsonl"), "--head", str(head),
                  "--out", str(out), "--budget-s", "600", "--cmd", sys.executable, str(fake)])
    assert rc == 0
    s = json.loads((out / "scored.json").read_text())
    assert s["head_version"] == "v" and s["parallel"] == 1
    got = {r["clip_id"]: (r["decision"], r["p_completed"]) for r in s["rows"]}
    assert got["holo_task_s1_cut"] == ("reject", 0.05)
    assert got["holo_task_s2_full"] == ("accept", 0.97)


def test_report_has_the_required_sections(tmp_path):
    rows = [{"clip_id": f"c{i}", "truth": "reject" if i % 2 else "accept",
             "decision": ["accept", "reject", "review"][i % 3], "checks": {}, "error": None,
             "not_run": False, "latency_s": 1.0, "p_completed": i / 40, "completed": None,
             "missing_steps": 0} for i in range(40)]
    scored = {"rows": rows, "rubric": "r", "rubric_version": 1, "budget_s": 10, "elapsed_s": 5}
    ids = [r["clip_id"] for r in rows[:10]]
    eng = {"scored_clip_ids": ids, "decisions": {i: "reject" for i in ids}}
    base = {"clips": {r["clip_id"]: r["truth"] for r in rows},
            "engines": {e: eng for e in th.GEMINI}}
    train = {"stage": "train", "train_sessions": 5, "head_version": "trained-n10",
             "train": {"clips": 10, "settings": {}}, "timings_s": {}}
    text = th.render(scored, base, train, None, {"run_id": "1", "commit": "abc"})
    for h in ("## Provenance", "## Training", "## Validation", "## Head to head",
              "## Validation clips the head got wrong", "## What this cannot show",
              "false accept rate"):
        assert h in text
    assert "passes" not in text and "fails" not in text.replace("fails to", "")


def test_tee_keeps_the_rubric_the_route_received(tmp_path):
    fake = tmp_path / "fake.py"
    fake.write_text(FAKE)
    rub = tmp_path / "r.json"
    rub.write_text('{"task": {"description": "d"}}')
    rc = th.tee([str(tmp_path / "d"), "--", sys.executable, str(fake), "check", "v.mp4",
                 "--rubric", str(rub), "--video-id", "c1_cut"])
    assert rc == 0
    assert json.loads((tmp_path / "d" / "c1_cut.rubric.json").read_text())["task"] == {
        "description": "d"}
    assert (tmp_path / "d" / "c1_cut.json").exists()


def test_manifest_from_annotations_matches_expected_ids(tmp_path, monkeypatch):
    ann = [{"video_name": "R1-gopro", "events": _events()},
           {"video_name": "R2-gopro", "events": _events(wrong=True)}]
    import io
    import zipfile
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("train-v1_2.txt", "R1-gopro\nR2-gopro\n")
    blobs = {th.holo.ANNOTATIONS_URL: json.dumps(ann).encode(), th.holo.SPLITS_URL: buf.getvalue()}
    monkeypatch.setattr(th, "_fetch", lambda _c, url: blobs[url])
    out = tmp_path / "m.jsonl"
    assert th.main(["manifest-from-annotations", "--split", "train", "--sessions", "5",
                    "--out", str(out)]) == 0
    from quellix_eval.datasets.manifest import load_manifest
    recs = load_manifest(out)
    assert sorted(r.clip_id for r in recs) == [
        "holo_task_R1-gopro_cut", "holo_task_R1-gopro_full", "holo_task_R2-gopro_cut"]
    assert all("[" in r.notes and r.task.steps == [] for r in recs)


def test_report_includes_the_checks_section():
    c = {"passed": True, "features": {
        "manifest_clips": 4, "dataset_clips": 4, "train_report_clips": 4, "ok": True,
        "reproduces_head": {"max_abs_diff": 0.0, "tolerance": 1e-6, "ok": True},
        "real_head": {"oof_auc": 0.9, "oof_mean_p_completed": 0.8,
                      "oof_mean_p_not_completed": 0.2, "ok": True,
                      "thresholds": {"reject_at": 0.1, "accept_at": 0.9},
                      "confusion_oof_at_head_thresholds": {
                          "completed": {"accept": 1, "reject": 0, "review": 1},
                          "not_completed": {"accept": 0, "reject": 1, "review": 1}}},
        "shuffle_control": {"permutations": 2, "oof_auc": [0.5, 0.52], "oof_auc_mean": 0.51,
                            "oof_auc_min": 0.5, "oof_auc_max": 0.52, "ok": True,
                            "bands": {"first": [0.41, 0.59], "mean": [0.45, 0.55]},
                            "first_permutation_report": {"out_of_fold_all": {
                                "n": 4, "reject_precision": None, "reject_recall": 0.0,
                                "false_accept_rate": 0.0, "false_reject_rate": 0.0,
                                "review_rate": 1.0}}}},
        "serve": {"clips_compared": 2, "max_abs_diff": 1e-5, "tolerance": 1e-3,
                  "all_task_text_equal": True, "no_p_completed": [], "problems": [], "ok": True}}
    text = "\n".join(th.render_checks(c))
    assert "## Checks before scoring" in text and "maximum absolute difference" in text
    assert "Not run." in "\n".join(th.render_checks(None))


def test_checks_report_without_the_serve_check(tmp_path):
    feats = {"manifest_clips": 4, "dataset_clips": 4, "train_report_clips": 4, "ok": False,
             "reproduces_head": {"max_abs_diff": 0.0, "tolerance": 1e-6, "ok": True},
             "real_head": {"oof_auc": 0.4, "oof_mean_p_completed": 0.4,
                           "oof_mean_p_not_completed": 0.5, "ok": False,
                           "thresholds": {"reject_at": 0.1, "accept_at": 0.9},
                           "confusion_oof_at_head_thresholds": {
                               "completed": {"accept": 0, "reject": 0, "review": 2},
                               "not_completed": {"accept": 0, "reject": 0, "review": 2}}},
             "shuffle_control": {"permutations": 2, "oof_auc": [0.5, 0.52], "oof_auc_mean": 0.51,
                                 "oof_auc_min": 0.5, "oof_auc_max": 0.52, "ok": True,
                                 "bands": {"first": [0.41, 0.59], "mean": [0.45, 0.55]},
                                 "first_permutation_report": {"out_of_fold_all": {
                                     "n": 4, "reject_precision": None, "reject_recall": 0.0,
                                     "false_accept_rate": 0.0, "false_reject_rate": 0.0,
                                     "review_rate": 1.0}}}}
    (tmp_path / "f.json").write_text(json.dumps(feats))
    (tmp_path / "t.json").write_text(json.dumps({"run_id": "1", "commit": "c"}))
    out = tmp_path / "r.md"
    assert th.main(["checks-report", "--features-check", str(tmp_path / "f.json"),
                    "--train", str(tmp_path / "t.json"), "--out", str(out)]) == 0
    text = out.read_text()
    assert "a check failed" in text and "Not run: a check on the feature matrix" in text
