import json
import re
from pathlib import Path

import pytest

from quellix_eval.baselines import ModelResponse
from quellix_eval.benchmark import gemini_v2 as g
from quellix_eval.benchmark.stats import check_pairs, decision_pair, metrics, wilson

RUBRIC = json.loads((Path(__file__).parents[2] / "rubrics" / "benchmark_v2_tasks.json")
                    .read_text())


def test_wilson_matches_reference_values():
    lo, hi = wilson(8, 10)
    assert (round(lo, 3), round(hi, 3)) == (0.490, 0.943)
    assert wilson(0, 0) is None
    lo, hi = wilson(0, 20)
    assert lo == 0.0 and hi == pytest.approx(0.161, abs=1e-3)


def test_metrics_always_report_both_error_types():
    pairs = [("pos", "pass")] * 6 + [("pos", "fail")] * 2 + [("pos", "uncertain")] * 2 + \
            [("neg", "fail")] * 5 + [("neg", "pass")] * 3 + [("neg", "uncertain")] * 2
    m = metrics(pairs)
    assert m.n == 20 and m.base_reject_rate.value == 0.5
    assert m.false_reject_rate.value == 0.2 and m.false_accept_rate.value == 0.3
    assert m.reject_precision.value == 5 / 7 and m.reject_recall.value == 0.5
    assert m.flag_recall.value == 0.7 and m.review_rate.value == 0.2
    assert m.false_reject_rate.fmt() == "0.20 [0.06-0.51] (2/10)"
    assert [name for name, _ in m.rows()][:3] == ["base reject rate", "false reject rate",
                                                 "false accept rate"]


def test_pairs():
    assert check_pairs("fail", "error") == ("neg", "uncertain")
    assert check_pairs("unknown", "fail") is None
    assert decision_pair("accept", "review") == ("pos", "uncertain")
    assert decision_pair("reject", None) == ("neg", "uncertain")


def test_prompts_carry_the_full_rubric_and_no_placeholder_is_left():
    rub = {**RUBRIC, "task": {"description": "Change the GoPro battery",
                              "steps": ["open", "swap"], "final_state": "closed"}}
    text = g.user_prompt(rub)
    assert json.dumps(rub, indent=2, ensure_ascii=False) in text
    assert "open; swap" in text and "closed" in text
    assert not re.search(r"\{(rubric_json|task_[a-z_]+)\}", text)
    assert "confidence" in g.system_prompt()
    schema = g.response_schema()
    for check in ("task_completed", "hands_visible", "framing", "technical", "privacy"):
        assert "confidence" in schema["properties"][check]["required"]


class Fake:
    def __init__(self, answer: dict, cost: float = 0.01, name: str = "gemini-3.1-flash-lite"):
        self.answer, self.cost, self.name, self.calls = answer, cost, name, 0

    def generate(self, video_path, system, prompt, schema):
        self.calls += 1
        return ModelResponse(json.dumps(self.answer), self.cost)


ANSWER = {
    "task_completed": {"completed": False, "confidence": 0.9},
    "hands_visible": {"ratio_both_manipulation": 0.3, "ratio_any_manipulation": 0.9,
                      "ratio_both_whole": 0.3, "ratio_any_whole": 0.9,
                      "manipulation_detected": True, "confidence": 0.8},
    "framing": {"off_target_ratio": 0.0, "unstable_ratio": 0.0, "confidence": 0.9},
    "technical": {"blur_ratio": 0.0, "bad_exposure_ratio": 0.0, "confidence": 0.9},
    "privacy": {"faces": [], "documents": [], "screens": [], "confidence": 0.9},
}


def test_judge_uses_the_rubric_and_records_spend(tmp_path):
    b = g.Budget(1.0)
    d, cost = g.judge(Fake(ANSWER), b, tmp_path / "missing.mp4", RUBRIC, "v1")
    assert d["decision"] == "reject" and d["checks"]["task_completed"]["status"] == "fail"
    assert d["checks"]["hands_visible"]["status"] == "skipped"     # off in this rubric
    assert cost == 0.01 and b.spent_usd == 0.01 and b.calls == {"gemini-3.1-flash-lite": 1}


def test_low_confidence_means_could_not_tell(tmp_path):
    unsure = {**ANSWER, "task_completed": {"completed": False, "confidence": 0.3}}
    d, _ = g.judge(Fake(unsure), g.Budget(1.0), tmp_path / "x.mp4", RUBRIC, "v1")
    assert d["decision"] == "review"
    assert d["checks"]["task_completed"]["status"] == "error"
    outs = g.to_outputs({**ANSWER, "hands_visible": {**ANSWER["hands_visible"],
                                                     "manipulation_detected": False}}, "m", {})
    assert "ratio_both_manipulation" not in outs["hands_visible"].measurements


def test_budget_refuses_before_overshooting():
    b = g.Budget(0.05, {"m": 0.02})
    for _ in range(2):
        b.reserve("m")
        b.record("m", 0.02)
    with pytest.raises(g.SpendCapReached):
        b.reserve("m")                     # 0.04 spent + 0.02 expected > 0.05
    assert b.refused == {"m": 1} and b.spent_usd == pytest.approx(0.04)
