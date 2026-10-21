import json
import sys
from pathlib import Path

import pytest
from test_ci import FAKE, fake_source

from quellix_eval import ci
from quellix_eval.baselines import ModelResponse
from quellix_eval.baselines.retry import RetryingClient, is_rate_limit, retry_delay_s
from quellix_eval.prices import cheapest_gemini_flash_lite

OK = {
    "hands_visible": dict.fromkeys(["ratio_both_manipulation", "ratio_any_manipulation",
                                    "ratio_both_whole", "ratio_any_whole"], 1.0),
    "framing": {"off_target_ratio": 0, "unstable_ratio": 0},
    "task_completed": {"completed": True, "confidence": 1.0},
    "privacy": {"faces": [], "documents": [], "screens": []},
    "technical": {"blur_ratio": 0, "bad_exposure_ratio": 0},
}


class Clock:
    def __init__(self):
        self.t = 0.0
        self.sleeps = []

    def now(self):
        return self.t

    def sleep(self, s):
        self.sleeps.append(s)
        self.t += s


class Flaky:
    name = "flaky"

    def __init__(self, script):
        self.script, self.calls = list(script), 0

    def generate(self, path, prompt):
        self.calls += 1
        step = self.script.pop(0) if self.script else "ok"
        if step == "ok":
            return ModelResponse(json.dumps(OK), 0.01)
        raise RuntimeError(step)


def retrying(inner, clock, **kw):
    return RetryingClient(inner, sleep=clock.sleep, clock=clock.now, **kw)


def test_429_is_retried_with_server_delay_then_succeeds():
    clock = Clock()
    inner = Flaky(["429 RESOURCE_EXHAUSTED. Please retry in 12.5s", "ok"])
    c = retrying(inner, clock, min_interval_s=0)
    assert c.generate(Path("x"), "p").cost_usd == 0.01
    assert inner.calls == 2 and clock.sleeps == [12.5] and c.retries == 1


def test_backoff_without_hint_and_give_up_after_max_retries():
    clock = Clock()
    inner = Flaky(["429"] * 10)
    c = retrying(inner, clock, min_interval_s=0, max_retries=2, base_backoff_s=10)
    with pytest.raises(RuntimeError):
        c.generate(Path("x"), "p")
    assert clock.sleeps == [10, 20] and inner.calls == 3


def test_other_errors_are_not_retried():
    clock = Clock()
    inner = Flaky(["boom"])
    with pytest.raises(RuntimeError, match="boom"):
        retrying(inner, clock, min_interval_s=0).generate(Path("x"), "p")
    assert inner.calls == 1 and clock.sleeps == []


def test_calls_are_paced():
    clock = Clock()
    c = retrying(Flaky([]), clock, min_interval_s=6)
    for _ in range(3):
        c.generate(Path("x"), "p")
    assert clock.sleeps == [6, 6] and clock.t == 12


def test_deadline_stops_the_client():
    clock = Clock()
    c = retrying(Flaky([]), clock, min_interval_s=0, deadline_s=5)
    c.generate(Path("x"), "p")
    clock.t = 10
    with pytest.raises(TimeoutError):
        c.generate(Path("x"), "p")
    c2 = retrying(Flaky(["429 retry in 100s"]), Clock(), min_interval_s=0, deadline_s=30)
    with pytest.raises(TimeoutError):
        c2.generate(Path("x"), "p")


def test_rate_limit_detection():
    assert is_rate_limit(RuntimeError("429 Too Many Requests"))
    assert is_rate_limit(RuntimeError("RESOURCE_EXHAUSTED"))
    assert not is_rate_limit(RuntimeError("500 internal"))
    assert retry_delay_s(RuntimeError("retryDelay: '7s'")) == 7.0
    assert retry_delay_s(RuntimeError("nope")) is None


def test_cheapest_model_is_flash_lite():
    assert cheapest_gemini_flash_lite().endswith("flash-lite")
    assert cheapest_gemini_flash_lite() == "gemini-3.1-flash-lite"


def test_missing_key_skips_gemini_and_says_so():
    engines, notes = ci.build_engines({})
    assert list(engines) == ["worker"] and "SKIPPED" in notes[0] and "GEMINI_API_KEY" in notes[0]


def test_broken_gemini_setup_skips_gemini():
    def boom(model):
        raise ImportError("no google-genai")

    engines, notes = ci.build_engines({"GEMINI_API_KEY": "k"}, gemini_factory=boom)
    assert list(engines) == ["worker"] and "no google-genai" in notes[0]


def test_both_engines_side_by_side_and_one_clip_failure_is_isolated(tmp_path, monkeypatch):
    monkeypatch.delenv("GITHUB_STEP_SUMMARY", raising=False)
    monkeypatch.setattr(ci, "cheapest_gemini_flash_lite", lambda: "gemini-3.1-flash-lite")
    models = []
    # clip 1 is rate limited forever (all retries fail), the rest answer fine
    inner = Flaky(["429"] * 3)

    def factory(model):
        models.append(model)
        return inner

    engines, notes = ci.build_engines(
        {"GEMINI_API_KEY": "k"}, [sys.executable, str(FAKE)], factory,
        gemini_budget_s=3600, gemini_interval_s=0, gemini_retries=2, sleep=lambda s: None)
    rubric = json.loads(ci.DEFAULT_RUBRIC.read_text())
    rubric["checks"]["technical"].update(min_width=64, min_height=48)
    rp = tmp_path / "rubric.json"
    rp.write_text(json.dumps(rubric))
    report = ci.run_ci(tmp_path / "out", 3, fake_source, engines, rp, notes=notes)
    assert models == ["gemini-3.1-flash-lite"]
    assert "| worker |" in report and "| gemini |" in report
    assert "Gemini model: `gemini-3.1-flash-lite`" in report
    assert "First failures of **gemini**" in report and "Per check, side by side" in report
    assert "assumed acceptable" in report
    gem_row = next(ln for ln in report.splitlines() if ln.startswith("| gemini | "))
    assert gem_row.split("|")[-2].strip() == "1"      # only the first clip failed


def test_check_metrics():
    m = ci.check_metrics({("fail", "fail"): 6, ("fail", "pass"): 2, ("fail", "uncertain"): 2,
                          ("pass", "fail"): 2, ("pass", "pass"): 8})
    assert m["precision"] == pytest.approx(0.75) and m["recall"] == pytest.approx(0.6)
    assert m["flag_recall"] == pytest.approx(0.8) and m["review_rate"] == pytest.approx(2 / 20)
    assert ci.check_metrics({})["precision"] is None
