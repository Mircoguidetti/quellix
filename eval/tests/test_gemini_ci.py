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


def test_models_are_tried_cheapest_first():
    from quellix_eval.prices import gemini_models_by_price

    order = gemini_models_by_price()
    assert order[0] == "gemini-3.1-flash-lite" and order[-1] == "gemini-3.1-pro-preview"
    engines, notes = ci.build_engines({"GEMINI_API_KEY": "k"}, gemini_factory=lambda m: Flaky([]))
    assert list(engines) == ["worker", "gemini"]
    assert order[0] in notes[0] and "SKIPPED" not in notes[0]


QUOTA_0 = ("429 RESOURCE_EXHAUSTED. Quota exceeded for metric "
           "generate_content_free_tier_requests, limit: 0, model: {model}")


class ByModel:
    """A fake Gemini where every model id behaves differently."""

    def __init__(self, behaviour):
        self.behaviour, self.calls = behaviour, []

    def factory(self, model):
        outer = self

        class C:
            name = model

            def generate(self, path, prompt):
                outer.calls.append(model)
                b = outer.behaviour[model]
                if b == "ok":
                    return ModelResponse(json.dumps(OK), 0.01)
                raise RuntimeError(b.replace("{model}", model))

        return C()


def fallback(behaviour, models, patience=2):
    from quellix_eval.baselines.fallback import FallbackClient

    by = ByModel(behaviour)
    clock = Clock()
    fb = FallbackClient(
        models, by.factory,
        lambda inner: retrying(inner, clock, min_interval_s=0, max_retries=1, base_backoff_s=1),
        patience=patience)
    return fb, by


def test_no_free_quota_falls_back_to_the_next_model_without_waiting():
    fb, by = fallback({"a": QUOTA_0, "b": "ok"}, ["a", "b"])
    assert fb.generate(Path("x"), "p").cost_usd == 0.01
    assert by.calls == ["a", "b"] and fb.current == "b"
    assert "no free quota" in fb.dropped["a"]
    assert "limit: 0" in fb.first_rate_limit_body and "model: a" in fb.first_rate_limit_body
    fb.generate(Path("x"), "p")
    assert by.calls == ["a", "b", "b"] and fb.served["b"] == 2
    text = fb.describe()
    assert "`b`: 2 clips served" in text and "limit: 0" in text
    assert "First raw quota/billing error" in text


def test_unknown_model_id_falls_back():
    fb, _ = fallback({"a": "404 NOT_FOUND. models/a is not found", "b": "ok"}, ["a", "b"])
    fb.generate(Path("x"), "p")
    assert fb.current == "b" and "404" in fb.dropped["a"]


def test_persistent_rate_limit_drops_a_model_after_two_clips():
    fb, by = fallback({"a": "429 slow down", "b": "ok"}, ["a", "b"])
    with pytest.raises(RuntimeError):       # first clip: gives up, model kept
        fb.generate(Path("x"), "p")
    assert fb.current == "a"
    fb.generate(Path("x"), "p")             # second clip in a row: drop "a", "b" answers
    assert fb.current == "b" and fb.served["b"] == 1 and "rate limited" in fb.dropped["a"]


def test_other_errors_do_not_drop_a_model_and_last_model_gives_up():
    fb, _ = fallback({"a": "500 boom", "b": "ok"}, ["a", "b"])
    with pytest.raises(RuntimeError, match="boom"):
        fb.generate(Path("x"), "p")
    assert fb.current == "a"
    fb, _ = fallback({"a": QUOTA_0}, ["a"])
    with pytest.raises(RuntimeError):
        fb.generate(Path("x"), "p")


def test_broken_client_construction_falls_through_and_is_reported(tmp_path, monkeypatch):
    monkeypatch.delenv("GITHUB_STEP_SUMMARY", raising=False)

    def boom(model):
        raise ImportError("no google-genai")

    engines, notes = ci.build_engines({"GEMINI_API_KEY": "k"}, [sys.executable, str(FAKE)], boom)
    rubric = json.loads(ci.DEFAULT_RUBRIC.read_text())
    rubric["checks"]["technical"].update(min_width=64, min_height=48)
    rp = tmp_path / "r.json"
    rp.write_text(json.dumps(rubric))
    report = ci.run_ci(tmp_path / "out", 2, fake_source, engines, rp, notes=notes,
                       subset_sources={"gemini": 1})
    assert "no google-genai" in report and "gemini (4 clips)" in report


def test_subset_run_compares_worker_and_gemini_on_the_same_clips(tmp_path, monkeypatch):
    monkeypatch.delenv("GITHUB_STEP_SUMMARY", raising=False)
    by = ByModel({"gemini-3.1-flash-lite": QUOTA_0, "gemini-3.5-flash-lite": "ok"})
    engines, notes = ci.build_engines(
        {"GEMINI_API_KEY": "k"}, [sys.executable, str(FAKE)], by.factory,
        gemini_budget_s=3600, gemini_interval_s=0, sleep=lambda s: None)
    rubric = json.loads(ci.DEFAULT_RUBRIC.read_text())
    rubric["checks"]["technical"].update(min_width=64, min_height=48)
    rp = tmp_path / "rubric.json"
    rp.write_text(json.dumps(rubric))
    report = ci.run_ci(tmp_path / "out", 3, fake_source, engines, rp, notes=notes,
                       subset_sources={"gemini": 2})
    manifest = ci.load_manifest(tmp_path / "out" / "manifest.jsonl")
    assert len(manifest) == 12 and len(ci.subset_for(manifest, 2)) == 8
    for col in ("worker (all 12)", "worker (same 8)", "gemini (8 clips)"):
        assert f"| {col} |" in report
    assert "`gemini-3.5-flash-lite`: 8 clips served" in report
    assert "no free quota" in report and "First raw quota/billing error" in report
    assert "limit: 0" in report
    assert by.calls.count("gemini-3.1-flash-lite") == 1       # tried once, then dropped
    assert "| gemini (8 clips) |" in report


def test_subset_is_fixed_originals_plus_their_variants():
    from quellix_eval.datasets.manifest import ClipRecord, TaskSpec

    def rec(i):
        return ClipRecord(clip_id=i, source="synthetic", license="synthetic", path="p",
                          task=TaskSpec(description="d"), truth="accept")

    m = [rec(i) for i in ("s0", "s1", "s2", "s10")] + [
        rec(f"{s}__{v}") for s in ("s0", "s1", "s2", "s10") for v in ("blur", "face")]
    ids = [c.clip_id for c in ci.subset_for(m, 2)]
    assert ids == ["s0", "s1", "s0__blur", "s0__face", "s1__blur", "s1__face"]


def test_check_metrics():
    m = ci.check_metrics({("fail", "fail"): 6, ("fail", "pass"): 2, ("fail", "uncertain"): 2,
                          ("pass", "fail"): 2, ("pass", "pass"): 8})
    assert m["precision"] == pytest.approx(0.75) and m["recall"] == pytest.approx(0.6)
    assert m["flag_recall"] == pytest.approx(0.8) and m["review_rate"] == pytest.approx(2 / 20)
    assert ci.check_metrics({})["precision"] is None


BILLING = ("402 RESOURCE_EXHAUSTED. {'error': {'code': 402, 'message': 'Your prepayment credits "
           "are depleted. Please go to AI Studio to manage your project and billing.', "
           "'status': 'RESOURCE_EXHAUSTED'}}")


def test_depleted_credits_stop_gemini_at_once_and_say_so():
    from quellix_eval.baselines.retry import is_billing_problem, is_rate_limit

    assert is_billing_problem(RuntimeError(BILLING)) and is_rate_limit(RuntimeError(BILLING))
    assert not is_billing_problem(RuntimeError("429 RESOURCE_EXHAUSTED limit: 0"))
    clock = Clock()
    fb, by = fallback({"a": BILLING, "b": "ok"}, ["a", "b"])
    for _ in range(3):
        with pytest.raises(RuntimeError, match="billing problem"):
            fb.generate(Path("x"), "p")
    assert by.calls == ["a"]                  # one real call, then nothing: no retries, no b
    assert fb.current == "a" and clock.sleeps == []
    text = fb.describe()
    assert "BLOCKED" in text and "prepayment credits are depleted" in text


def test_billing_error_is_not_retried_inside_the_retrying_client():
    clock = Clock()
    inner = Flaky([BILLING])
    with pytest.raises(RuntimeError):
        retrying(inner, clock, min_interval_s=0).generate(Path("x"), "p")
    assert inner.calls == 1 and clock.sleeps == []
