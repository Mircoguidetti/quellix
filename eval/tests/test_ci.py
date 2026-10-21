import json
import sys
from pathlib import Path

from quellix_eval import ci
from quellix_eval.datasets.manifest import ClipRecord, TaskSpec, load_manifest, write_manifest
from quellix_eval.defects import make_clean_clip, write_video
from quellix_eval.run import worker_engine

FAKE = Path(__file__).parent / "fake_worker_cli.py"


def fake_source(out: Path, data_dir: Path, n: int) -> int:
    recs = []
    for i in range(n):
        p = data_dir / f"s{i}.mp4"
        c = make_clean_clip(seed=i)
        write_video(p, c.frames, c.fps)
        recs.append(ClipRecord(
            clip_id=f"s{i}", source="builddotai/Egocentric-10K", license="apache-2.0",
            path=str(p), task=TaskSpec(description="Factory work."), truth="accept",
            labels_source="baseline", duration_s=2.0))
    return write_manifest(recs, out)


def test_round_robin_covers_every_variant():
    seen = {v for i in range(4) for v in ci.pick_variants(i)}
    assert seen == set(ci.CI_VARIANTS)
    assert all(len(set(ci.pick_variants(i))) == 3 for i in range(10))


def test_manifest_lists_originals_before_duplicates_and_labels_honestly(tmp_path):
    fake_source(tmp_path / "s.jsonl", tmp_path / "src", 4)
    m = ci.build_eval_manifest(load_manifest(tmp_path / "s.jsonl"), tmp_path / "v")
    ids = [r.clip_id for r in m]
    assert len(m) == 4 + 4 * 3
    assert ids[:4] == ["s0", "s1", "s2", "s3"]            # all originals come first
    by_id = {r.clip_id: r for r in m}
    assert by_id["s0"].checks == {"technical": "pass", "privacy": "pass", "originality": "pass"}
    for r in m[4:]:
        assert r.truth == "reject" and r.labels_source == "synthetic"
        if "__dup_" in r.clip_id:
            assert r.checks["originality"] == "fail"
        else:
            assert r.checks["originality"] == "unknown"


def test_end_to_end_report(tmp_path, monkeypatch):
    summary = tmp_path / "summary.md"
    monkeypatch.setenv("GITHUB_STEP_SUMMARY", str(summary))
    rubric = json.loads(ci.DEFAULT_RUBRIC.read_text())
    rubric["checks"]["technical"].update(min_width=64, min_height=48)
    rp = tmp_path / "rubric.json"
    rp.write_text(json.dumps(rubric))
    report = ci.run_ci(tmp_path / "out", 4, fake_source,
                       {"worker": worker_engine([sys.executable, str(FAKE)])}, rp)
    assert report == (tmp_path / "out" / "report.md").read_text()
    assert summary.read_text() == report
    for text in ("assumed acceptable", "Checks that are OFF",
                 "Per-check confusion", "| technical |", "| originality |",
                 "Decisions by variant", "base reject rate", "Per check, side by side",
                 "latency p50"):
        assert text in report
    assert (tmp_path / "out" / "manifest.jsonl").exists()
    assert not (tmp_path / "out" / "work").exists()        # media cleaned up


def test_eval_rubric_is_valid_and_matches_the_issue():
    from quellix_worker.contracts import validate_rubric

    r = json.loads(ci.DEFAULT_RUBRIC.read_text())
    validate_rubric(r)
    c = r["checks"]
    assert not c["hands_visible"]["enabled"] and not c["task_completed"]["enabled"]
    assert "min_width" not in c["technical"]
    assert {c["privacy"][k] for k in ("faces", "documents", "screens")} == {"reject"}


def test_report_starts_with_requested_and_actual_count(tmp_path, monkeypatch):
    monkeypatch.delenv("GITHUB_STEP_SUMMARY", raising=False)
    report = ci.run_ci(tmp_path / "out", 6, fake_source,
                       {"worker": worker_engine([sys.executable, str(FAKE)])}, ci.DEFAULT_RUBRIC)
    assert report.splitlines()[2] == ("**Source clips: requested **6**, got 6** "
                                      "(24 clips with synthetic defects).")

    def short_source(out, data_dir, n):
        return fake_source(out, data_dir, 2)

    report = ci.run_ci(tmp_path / "out2", 5, short_source,
                       {"worker": worker_engine([sys.executable, str(FAKE)])}, ci.DEFAULT_RUBRIC)
    assert "requested **5**, got 2" in report and "WARNING: 3 fewer than requested" in report
