import json

import pytest
from test_ci import fake_source

from quellix_eval import ci
from quellix_eval.ci import PhaseLimits
from quellix_eval.run import EngineResult


class Clock:
    def __init__(self):
        self.t = 0.0

    def __call__(self):
        return self.t


def decision(label="accept"):
    return {"decision": label, "checks": {"technical": {"status": "pass"}}}


def rubric(tmp_path):
    r = json.loads(ci.DEFAULT_RUBRIC.read_text())
    p = tmp_path / "rubric.json"
    p.write_text(json.dumps(r))
    return p


def run(tmp_path, engines, **kw):
    kw.setdefault("subset_sources", {"gemini": 2})
    return ci.run_ci(tmp_path / "out", 4, fake_source, engines, rubric(tmp_path), **kw)


def test_gemini_runs_first_and_the_worker_does_subset_then_rest(tmp_path):
    order = []

    def mk(name, cost=0.0):
        def engine(clip, rub):
            order.append((name, clip.clip_id))
            return EngineResult(decision(), cost)
        return engine

    run(tmp_path, {"worker": mk("worker"), "gemini": mk("gemini", 0.01)},
        limits={"gemini": PhaseLimits(600, 1.0)})
    names = [n for n, _ in order]
    first_worker = names.index("worker")
    assert set(names[:first_worker]) == {"gemini"} and names.count("gemini") == 8
    worker_ids = [c for n, c in order if n == "worker"]
    gem_ids = [c for n, c in order if n == "gemini"]
    assert worker_ids[:8] == gem_ids          # the worker starts with exactly Gemini's subset
    assert len(worker_ids) == 16 and len(set(worker_ids)) == 16


def test_gemini_time_budget_is_its_own_and_unreached_clips_are_not_failures(tmp_path):
    clock = Clock()

    def slow(clip, rub):
        clock.t += 100            # each Gemini clip takes 100 s
        return EngineResult(decision(), 0.0)

    def fast(clip, rub):
        return EngineResult(decision(), 0.0)

    lim = PhaseLimits(250, 1.0, clock=clock)       # room for three clips
    report = run(tmp_path, {"worker": fast, "gemini": slow}, limits={"gemini": lim})
    assert lim.stopped_by == "time budget"
    row = next(ln for ln in report.splitlines() if ln.startswith("| gemini (8 clips) |"))
    cells = [c.strip() for c in row.strip("|").split("|")]
    assert cells[-2] == "0" and cells[-1] == "5"          # failed 0, not run 5
    assert "STOPPED early: time budget reached" in report
    assert "| worker (all 16) |" in report and "| worker (same 8) |" in report


def test_spend_cap_stops_the_phase_and_reports_the_spend(tmp_path):
    def gem(clip, rub):
        return EngineResult(decision(), 0.4)

    lim = PhaseLimits(600, 1.0)
    report = run(tmp_path, {"worker": lambda c, r: EngineResult(decision()), "gemini": gem},
                 limits={"gemini": lim})
    # three clips, then the cap stops the phase
    assert lim.spent_usd == pytest.approx(1.2) and lim.stopped_by == "spend cap"
    assert "$1.2000 spent of the $1.00 cap" in report
    assert "STOPPED early: spend cap reached" in report
    row = next(ln for ln in report.splitlines() if ln.startswith("| gemini (8 clips) |"))
    assert row.strip("|").split("|")[-1].strip() == "5"


def test_worker_stops_at_the_job_deadline_and_never_starves_on_gemini(tmp_path):
    clock = Clock()

    def worker(clip, rub):
        clock.t += 60
        return EngineResult(decision(), 0.0)

    def gem(clip, rub):
        clock.t += 10
        return EngineResult(decision(), 0.0)

    # 1 hour left in total: Gemini may use all but the worker's minimum and the report reserve.
    lim = PhaseLimits(10_000, 1.0, clock=clock)
    worker_lim = PhaseLimits(float("inf"), clock=clock)
    report = run(tmp_path, {"worker": worker, "gemini": gem},
                 limits={"gemini": lim, "worker": worker_lim},
                 job_deadline=3600, clock=clock)
    assert lim.budget_s == 3600 - ci.WORKER_MIN_S - ci.REPORT_RESERVE_S
    assert worker_lim.stopped_by is None or worker_lim.stopped_by == "time budget"
    # the worker did the whole subset (8 clips) and whatever else fit before the deadline
    row = next(ln for ln in report.splitlines() if ln.startswith("| worker (all 16) |"))
    same = next(ln for ln in report.splitlines() if ln.startswith("| worker (same 8) |"))
    assert same.strip("|").split("|")[-1].strip() == "0"             # subset fully run
    not_run = int(row.strip("|").split("|")[-1].strip())
    assert 0 <= not_run <= 8


def test_a_phase_with_no_budget_left_is_reported_not_crashed(tmp_path):
    clock = Clock()
    lim = PhaseLimits(0, 1.0, clock=clock)           # no time at all
    report = run(tmp_path, {"worker": lambda c, r: EngineResult(decision()),
                            "gemini": lambda c, r: EngineResult(decision(), 0.1)},
                 limits={"gemini": lim})
    assert "did not run any clip" in report and "| gemini (8 clips) |" not in report
    assert "| worker (all 16) |" in report


def test_phase_limits_unit():
    clock = Clock()
    lim = PhaseLimits(60, 0.5, clock=clock)
    assert lim.check() is None                  # the clock starts at the first clip
    clock.t = 59
    assert lim.check() is None
    lim.spent_usd = 0.5
    assert lim.check() == "spend cap"
    assert lim.describe("Gemini").startswith("Gemini phase: $0.5000 spent of the $0.50 cap")


def test_describe_reports_the_phase_length_not_the_time_since():
    clock = Clock()
    lim = PhaseLimits(720, 1.0, clock=clock)
    from quellix_eval.ci import _limited

    engine = _limited(lambda clip, rub: EngineResult(decision(), 0.01), lim)
    clock.t = 100
    engine(object(), {})          # first clip starts the clock at t=100
    clock.t = 400
    engine(object(), {})          # a clip ends at t=400: the phase lasted 300 s
    clock.t = 5000                # the report is rendered much later (the worker ran meanwhile)
    assert "5.0 of 12 minutes used" in lim.describe("Gemini")
