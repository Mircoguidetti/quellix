import numpy as np
import pytest

from quellix_tasks.features import FEATURE_NAMES
from quellix_tasks.head import Head, default_head
from quellix_tasks.library import library, resolve_task
from quellix_tasks.model import TaskModel

from .conftest import COMPLETE, CUT, MISSING, TASK, frames_for

F = {n: i for i, n in enumerate(FEATURE_NAMES)}


def _run(encoder, seq, head=None, task=TASK):
    frames, times = frames_for(seq)
    out = TaskModel(encoder, head or default_head()).run({"task": task}, frames, times)
    assert out.error is None, out.error
    return out


def _features(encoder, seq):
    frames, times = frames_for(seq)
    model = TaskModel(encoder, default_head())
    analysis, _ = model.analyse_embeddings(TASK, encoder.embed_images(frames), times)
    return analysis.features


def test_complete_video_finds_every_step_with_times(encoder):
    m = _run(encoder, COMPLETE).measurements
    assert m["missing_steps"] == []
    starts = [s["start_s"] for s in m["steps"]]
    assert starts == sorted(starts)
    assert m["steps"][0]["start_s"] == pytest.approx(3, abs=1)
    assert m["start_s"] == m["steps"][0]["start_s"] and m["end_s"] == m["steps"][-1]["end_s"]
    assert m["steps"][0]["t_s"] == m["steps"][0]["start_s"]   # worker contract: {name, t_s}


def test_features_separate_complete_cut_and_missing(encoder):
    full, cut, missing = (_features(encoder, s) for s in (COMPLETE, CUT, MISSING))
    assert full[F["frac_steps_found"]] == 1.0
    assert missing[F["frac_steps_found"]] < 1.0
    assert cut[F["last_step_open"]] == 1.0 and full[F["last_step_open"]] == 0.0
    assert full[F["final_state_rise"]] > cut[F["final_state_rise"]]


def test_default_head_orders_cases_and_never_accepts_doubt(encoder):
    p = {name: _run(encoder, s).measurements["p_completed"]
         for name, s in (("full", COMPLETE), ("cut", CUT), ("missing", MISSING))}
    assert p["full"] > p["cut"] and p["full"] > p["missing"]
    for seq in (CUT, MISSING):
        assert _run(encoder, seq).measurements["completed"] is not True


def test_three_way_output_follows_thresholds(encoder):
    n = len(FEATURE_NAMES)
    always = Head([0.0] * n, bias=0.0, accept_at=0.9, reject_at=0.1)   # p = 0.5 -> unsure
    m = _run(encoder, COMPLETE, always).measurements
    assert m["completed"] is None and m["confidence"] == 0.5
    sure_yes = Head([0.0] * n, bias=5.0, accept_at=0.9, reject_at=0.1)
    assert _run(encoder, COMPLETE, sure_yes).measurements["completed"] is True
    sure_no = Head([0.0] * n, bias=-5.0, accept_at=0.9, reject_at=0.1)
    m = _run(encoder, CUT, sure_no).measurements
    assert m["completed"] is False and m["confidence"] > 0.99


def test_errors_become_check_errors_not_guesses(encoder):
    frames, times = frames_for([("red", 2)])
    out = TaskModel(encoder).run({"task": TASK}, frames, times)
    assert out.measurements is None and "too few frames" in out.error
    frames, times = frames_for(COMPLETE)
    out = TaskModel(encoder).run({"task": {}}, frames, times)
    assert out.measurements is None and "neither steps nor a description" in out.error
    assert out.model.startswith("tasks@")


def test_library_fills_missing_steps_and_rubric_wins():
    lib = library()
    assert len(lib) >= 10 and all(t.steps and t.final_state for t in lib.values())
    t = resolve_task({"library_id": "load_dishwasher", "description": "x"})
    assert t.steps == lib["load_dishwasher"].steps and t.description == "x"
    own = resolve_task({"library_id": "load_dishwasher", "steps": ["a"], "final_state": "b"})
    assert own.steps == ("a",) and own.final_state == "b"
    assert resolve_task({"description": "wipe it"}).steps == ("wipe it",)


def test_head_round_trip_and_validation(tmp_path):
    h = default_head()
    h.save(tmp_path / "h.json")
    assert Head.load(tmp_path / "h.json") == h
    with pytest.raises(ValueError):
        Head([0.0] * len(FEATURE_NAMES), 0.0, accept_at=0.2, reject_at=0.5)
    with pytest.raises(ValueError):
        Head([0.0], 0.0, feature_names=["other"])
    assert np.isclose(h.proba(np.zeros(len(FEATURE_NAMES)))[0], 1 / (1 + np.exp(3.0)))
