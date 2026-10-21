import json
import sys
from pathlib import Path

import pytest

from quellix_eval.baselines import ModelResponse
from quellix_eval.datasets.manifest import load_manifest
from quellix_eval.run import (
    baseline_engine,
    evaluate_engine,
    format_runs,
    main,
    worker_engine,
)

FAKE = Path(__file__).parent / "fake_worker_cli.py"


class Optimist:
    """A 'general model' that says everything is perfect."""

    name = "optimist"

    def generate(self, path, prompt):
        ans = {"hands_visible": dict.fromkeys(
                   ["ratio_both_manipulation", "ratio_any_manipulation",
                    "ratio_both_whole", "ratio_any_whole"], 1.0),
               "framing": {"off_target_ratio": 0, "unstable_ratio": 0},
               "task_completed": {"completed": True, "confidence": 1.0},
               "privacy": {"faces": [], "documents": [], "screens": []},
               "technical": {"blur_ratio": 0, "bad_exposure_ratio": 0}}
        return ModelResponse(json.dumps(ans), 0.05)


def test_end_to_end_on_generated_fixture_set(fixture_set, capsys):
    cmd = [sys.executable, str(FAKE)]
    rc = main(
        ["--manifest", str(fixture_set / "m.jsonl"), "--engine", "worker", "--engine", "gemini",
         "--rubric", str(fixture_set / "rubric.json")],
        engines={"worker": _w(cmd),
                 "gemini": baseline_engine(Optimist())},
    )
    out = capsys.readouterr().out
    assert rc == 0
    assert "clips: 14" in out and "base reject rate: 0.857" in out
    assert "reject precision" in out and "cost USD / video hour" in out
    assert "per-check confusion [worker]" in out and "per-check confusion [gemini]" in out


def _w(cmd):
    # The fake CLI takes `check ...` as its first argument, like the real worker CLI.
    return worker_engine(cmd)


def test_worker_catches_defects_optimist_does_not(fixture_set):
    clips = load_manifest(fixture_set / "m.jsonl")
    rubric = json.loads((fixture_set / "rubric.json").read_text())
    w = evaluate_engine("worker", _w([sys.executable, str(FAKE)]), clips, rubric)
    o = evaluate_engine("optimist", baseline_engine(Optimist()), clips, rubric)
    assert w.failures == 0 and w.report.reject_precision == 1.0
    assert w.report.reject_recall > o.report.reject_recall
    assert w.cost_per_hour and o.cost_per_hour and o.cost_per_hour > w.cost_per_hour
    assert "hands_visible" not in w.confusion      # unknown labels are skipped
    assert w.confusion["task_completed"][("fail", "fail")] >= 2
    text = format_runs([w, o])
    assert text.count("base reject rate") >= 2 and "cost USD / video hour" in text


def test_missing_worker_cli_is_a_failed_run_not_a_crash(fixture_set):
    clips = load_manifest(fixture_set / "m.jsonl")[:3]
    rubric = json.loads((fixture_set / "rubric.json").read_text())
    bad = worker_engine(["/nonexistent/binary"])
    r = evaluate_engine("worker", bad, clips, rubric)
    assert r.failures == 3 and r.report.review_rate == 1.0
    crashing = worker_engine([sys.executable, "-c", "import sys; sys.exit(3)"])
    assert evaluate_engine("w", crashing, clips, rubric).failures == 3


def test_cost_comes_from_report_file(fixture_set):
    clips = load_manifest(fixture_set / "m.jsonl")[:2]
    rubric = json.loads((fixture_set / "rubric.json").read_text())
    r = evaluate_engine("w", _w([sys.executable, str(FAKE)]), clips, rubric)
    assert r.cost_usd == pytest.approx(0.002)
