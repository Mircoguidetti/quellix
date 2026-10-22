import json
import sys
from pathlib import Path

import pytest

from quellix_eval.baselines import ModelResponse
from quellix_eval.benchmark import kit, report, runner
from quellix_eval.benchmark.gemini_v2 import STRONG_MODEL, Budget
from quellix_eval.benchmark.media import cut
from quellix_eval.datasets.manifest import ClipRecord, TaskSpec
from quellix_eval.defects import make_clean_clip, read_video, write_video

FAKE = Path(__file__).parents[1] / "fake_worker_cli.py"
RUBRIC = json.loads((runner.RUBRICS / "benchmark_v2_tasks.json").read_text())


def _clips(tmp_path, n=4):
    out = []
    for i in range(n):
        frames = 60 if i % 2 == 0 else 20          # the fake worker: >= 40 frames = completed
        c = make_clean_clip(n_frames=frames, seed=i)
        p = tmp_path / f"c{i}.mp4"
        write_video(p, c.frames, c.fps)
        full = i % 2 == 0
        out.append(ClipRecord(clip_id=f"holo_task_s{i}_{'full' if full else 'cut'}",
                              source="holoassist", license="cdla-permissive-2.0", path=str(p),
                              task=TaskSpec(description="d"), truth="accept" if full else "reject",
                              checks={"task_completed": "pass" if full else "fail"}))
    return out


class Fake:
    def __init__(self, name, script):
        self.name, self.script, self.calls = name, list(script), 0

    def generate(self, video_path, system, prompt, schema):
        self.calls += 1
        step = self.script.pop(0) if self.script else "ok"
        if step != "ok":
            raise RuntimeError(step)
        return ModelResponse(json.dumps({"task_completed": {"completed": False,
                                                            "confidence": 0.9}}), 0.02)


def test_run_gemini_retries_429_and_stops_at_the_cap(tmp_path):
    clips = _clips(tmp_path)
    client = Fake("m", ["429 RESOURCE_EXHAUSTED retry in 3s"])
    sleeps: list[float] = []
    budget = Budget(0.05, {"m": 0.02})
    res = runner.run_gemini(client, budget, clips, RUBRIC, deadline=float("inf"),
                            interval_s=0, sleep=sleeps.append)
    assert 3.0 in sleeps                                     # server-suggested delay honoured
    done = [r for r in res.values() if not r.not_run]
    assert len(done) == 2 and budget.spent_usd == pytest.approx(0.04)
    assert all(r.not_run and "spend cap" in r.error for r in list(res.values())[2:])


def test_run_gemini_stops_at_the_deadline(tmp_path):
    clips = _clips(tmp_path, 2)
    t = iter([0.0, 0.0, 1.0, 1.0, 100.0, 100.0, 100.0])
    res = runner.run_gemini(Fake("m", []), Budget(9), clips, RUBRIC, deadline=50,
                            interval_s=0, sleep=lambda s: None, clock=lambda: next(t))
    assert [r.not_run for r in res.values()] == [False, True]


def test_balanced_order_alternates_truths(tmp_path):
    clips = _clips(tmp_path, 4)
    assert [c.truth for c in runner.balanced_order(clips)] == ["reject", "accept"] * 2


def test_slice_end_to_end_and_report(tmp_path):
    clips = _clips(tmp_path, 4)
    budget = Budget(0.03, {STRONG_MODEL: 0.02, "gemini-3.1-flash-lite": 0.001})
    gem = {"gemini-3.1-flash-lite": Fake("gemini-3.1-flash-lite", []),
           STRONG_MODEL: Fake(STRONG_MODEL, [])}
    results = runner.run_slice("tasks", clips, RUBRIC, budget, float("inf"), 2, gem,
                               worker_cmd=[sys.executable, str(FAKE)], interval_s=0)
    assert set(results) == {"worker", "gemini:gemini-3.1-flash-lite", f"gemini:{STRONG_MODEL}"}
    w = results["worker"]
    assert {r.decision for r in w.values()} == {"accept", "reject"}
    out = tmp_path / "res" / "results.json"
    runner.write_results(out, "tasks", RUBRIC, clips, results, budget, {"skipped": {"x": 1}})
    data = json.loads(out.read_text())
    assert data["spend"]["spent_usd"] <= 0.03 + 0.02
    text = report.render([data], {"commit": "abc1234", "run": "1"})
    for s in ("# Ormes benchmark v2", "false reject rate", "false accept rate",
              "Independent labels (headline)", "HoloAssist: task completion",
              "Check `task_completed`", "[", "Not included: 1 x", "Egocentric-10K blind labels: "
              "pending", "eval/prompts/benchmark_v2/"):
        assert s in text, s
    assert "Ormes, same" in text                 # the capped strong model gets a fair row
    assert "| Ormes | 4 | 0.50 | 0.00 [0.00-0.66] (0/2) | 0.00 [0.00-0.66] (0/2) |" in text


def test_blind_labels_become_their_own_slice(tmp_path):
    synthetic = {"slice": "synthetic", "rubric": {}, "clips": [
        {"clip_id": "e1", "truth": "accept", "checks": {"technical": "pass"}},
        {"clip_id": "e1__blur", "truth": "reject", "checks": {"technical": "fail"}},
        {"clip_id": "e2", "truth": "accept", "checks": {}}],
        "engines": {"worker": {"e1": {"decision": "reject", "checks": {"privacy": "fail"}},
                               "e1__blur": {"decision": "reject"}, "e2": {"decision": "accept"}}},
        "spend": {"cap_usd": 1, "spent_usd": 0, "by_model": {}}}
    lab_path = tmp_path / "labels.jsonl"
    lab_path.write_text("\n".join(json.dumps({
        "clip_id": cid, "checks": {"privacy": p}, "truth": t, "labeller": "A. Person",
        "labelled_at": "2026-10-23", "blind": True}) for cid, p, t in
        [("e1", "fail", "reject"), ("e2", "pass", "accept")]) + "\n")
    labels = kit.load_labels(lab_path)
    blind = kit.blind_slice(synthetic, labels)
    assert [c["clip_id"] for c in blind["clips"]] == ["e1", "e2"]
    assert blind["clips"][0]["truth"] == "reject" and "A. Person" in blind["clips"][0]["notes"]
    assert set(blind["engines"]["worker"]) == {"e1", "e2"}
    text = report.render([synthetic, blind])
    assert "Egocentric-10K: blind human labels" in text and "pending" not in text
    bad = tmp_path / "bad.jsonl"
    bad.write_text(json.dumps({"clip_id": "e1", "checks": {}, "truth": "accept"}) + "\n")
    with pytest.raises(ValueError, match="blind"):
        kit.load_labels(bad)


def test_kit_shows_no_ormes_output(tmp_path):
    c = make_clean_clip(n_frames=8)
    p = tmp_path / "o.mp4"
    write_video(p, c.frames, c.fps)
    recs = [ClipRecord(clip_id=cid, source="builddotai/Egocentric-10K", license="apache-2.0",
                       path=str(p), task=TaskSpec(description="d"), truth="accept")
            for cid in ("orig1", "orig1__blur")]
    assert kit.build_kit(recs, tmp_path / "kit") == 1
    page = (tmp_path / "kit" / "index.html").read_text()
    assert "orig1" in page and "orig1__blur" not in page
    for leaked in ("decision", "measurement", "Ormes", "worker", "gemini"):
        assert leaked not in page
    assert (tmp_path / "kit" / "clips" / "orig1.mp4").exists()


def test_cut_writes_the_requested_window(tmp_path):
    c = make_clean_clip(n_frames=90, fps=30.0)
    src = tmp_path / "s.mp4"
    write_video(src, c.frames, c.fps)
    dur = cut(src, tmp_path / "w.mp4", 1.0, 2.0, width=64, fps=15)
    out = read_video(tmp_path / "w.mp4")
    assert dur == pytest.approx(1.0, abs=0.1) and out.frames[0].shape[1] == 64
    with pytest.raises(ValueError):
        cut(src, tmp_path / "x.mp4", 2.0, 2.0)
