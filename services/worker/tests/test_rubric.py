from __future__ import annotations

import copy
import json

import pytest

from quellix_worker import rubric as rubric_module
from quellix_worker.contracts import load_example, validate_decision, validate_rubric
from quellix_worker.pipeline import active_checks
from quellix_worker.rubric import CheckOutput, evaluate

RUBRIC = load_example("rubric.load_dishwasher.json")


def good_outputs() -> dict[str, CheckOutput]:
    return {
        "task_completed": CheckOutput({"completed": True, "confidence": 0.93,
                                       "start_s": 3.2, "end_s": 31.0}),
        "hands_visible": CheckOutput({"ratio_both_manipulation": 0.92,
                                      "ratio_any_manipulation": 0.99,
                                      "ratio_both_whole": 0.85, "ratio_any_whole": 0.95}),
        "framing": CheckOutput({"off_target_ratio": 0.02, "unstable_ratio": 0.03}),
        "technical": CheckOutput({"decodable": True, "duration_s": 34, "width": 1920,
                                  "height": 1080, "fps": 30, "blur_ratio": 0.01,
                                  "bad_exposure_ratio": 0.0}),
        "privacy": CheckOutput({"faces": [], "documents": [], "screens": []}),
        "originality": CheckOutput({"max_similarity": 0.12, "match_video_id": None}),
        "viewpoint": CheckOutput({"viewpoint": "first_person", "first_person_ratio": 0.95,
                                  "confidence": 0.9}),
    }


def run(outputs: dict[str, CheckOutput], rubric: dict | None = None) -> dict:
    """Only the checks the current decision contract knows (as the pipeline does)."""
    decision = evaluate("vid_1", rubric or RUBRIC, outputs, active_checks())
    validate_decision(decision)
    return decision


def test_example_rubric_is_valid() -> None:
    validate_rubric(RUBRIC)


def test_clean_video_is_accepted() -> None:
    d = run(good_outputs())
    assert d["decision"] == "accept"
    assert d["reasons"] == []
    assert d["rubric"] == {"id": "rub_example_dishwasher", "version": 1}
    assert all(c["status"] == "pass" for c in d["checks"].values())


@pytest.fixture
def hands_can_reject(monkeypatch: pytest.MonkeyPatch) -> None:
    """The one-line flip described in rubric.HANDS_CAN_REJECT."""
    monkeypatch.setattr(rubric_module, "HANDS_CAN_REJECT", True)


def test_hands_below_min_is_review_until_the_check_is_validated() -> None:
    """Issues #53 / #64: a critical hands failure must not reject while the check is unvalidated."""
    assert rubric_module.HANDS_CAN_REJECT is False
    o = good_outputs()
    o["hands_visible"] = CheckOutput({"ratio_both_manipulation": 0.61})
    d = run(o)
    assert d["decision"] == "review"
    reason = d["reasons"][0]
    assert reason["code"] == "hands_visible.below_min" and reason["effect"] == "review"
    assert "61%" in reason["message"] and "80%" in reason["message"]  # message unchanged
    m = d["checks"]["hands_visible"]["measurements"]
    assert m["reject_capped_to_review"] is True and "#64" in m["reject_cap_note"]
    assert m["ratio_both_manipulation"] == 0.61  # the real measurement is still recorded
    assert d["checks"]["hands_visible"]["status"] == "fail"


def test_hands_below_min_rejects_again_when_the_flag_is_flipped(hands_can_reject: None) -> None:
    o = good_outputs()
    o["hands_visible"] = CheckOutput({"ratio_both_manipulation": 0.61})
    d = run(o)
    assert d["decision"] == "reject"
    assert d["reasons"][0]["code"] == "hands_visible.below_min"
    assert d["reasons"][0]["effect"] == "reject"
    assert "reject_capped_to_review" not in d["checks"]["hands_visible"]["measurements"]


def test_the_cap_only_touches_the_hands_check() -> None:
    o = good_outputs()
    o["task_completed"] = CheckOutput({"completed": False, "confidence": 0.9})
    o["hands_visible"] = CheckOutput({"ratio_both_manipulation": 0.61})
    d = run(o)
    assert d["decision"] == "reject"  # the task check still rejects
    effects = {r["code"]: r["effect"] for r in d["reasons"]}
    assert effects == {"task_completed.not_completed": "reject",
                       "hands_visible.below_min": "review"}


def test_no_cap_note_when_hands_pass_or_are_not_critical() -> None:
    d = run(good_outputs())
    assert "reject_capped_to_review" not in d["checks"]["hands_visible"]["measurements"]
    rubric = json.loads(json.dumps(RUBRIC))
    rubric["checks"]["hands_visible"]["critical"] = False
    o = good_outputs()
    o["hands_visible"] = CheckOutput({"ratio_both_manipulation": 0.61})
    d = evaluate("v", rubric, o)
    assert d["decision"] == "review"
    assert "reject_capped_to_review" not in d["checks"]["hands_visible"]["measurements"]


def test_task_not_completed_rejects() -> None:
    o = good_outputs()
    o["task_completed"] = CheckOutput({"completed": False, "confidence": 0.9})
    assert run(o)["decision"] == "reject"


def test_low_confidence_on_task_goes_to_review_not_reject() -> None:
    o = good_outputs()
    o["task_completed"] = CheckOutput({"completed": False, "confidence": 0.4})
    d = run(o)
    assert d["decision"] == "review"
    assert d["checks"]["task_completed"]["status"] == "uncertain"


def test_non_critical_framing_failure_goes_to_review() -> None:
    o = good_outputs()
    o["framing"] = CheckOutput({"off_target_ratio": 0.3, "unstable_ratio": 0.0})
    d = run(o)
    assert d["decision"] == "review"
    assert d["reasons"][0]["code"] == "framing.off_target"


def test_face_goes_to_review_with_timestamp() -> None:
    o = good_outputs()
    o["privacy"] = CheckOutput({"faces": [{"t_s": 12.4}], "documents": [], "screens": []})
    d = run(o)
    assert d["decision"] == "review"
    assert "00:12" in d["reasons"][0]["message"]


def test_privacy_rule_set_to_reject_rejects() -> None:
    rubric = copy.deepcopy(RUBRIC)
    rubric["checks"]["privacy"]["documents"] = "reject"
    o = good_outputs()
    o["privacy"] = CheckOutput({"faces": [], "documents": [{"t_s": 5}], "screens": []})
    assert run(o, rubric)["decision"] == "reject"


def test_duplicate_is_rejected() -> None:
    o = good_outputs()
    o["originality"] = CheckOutput({"max_similarity": 0.98, "match_video_id": "vid_0"})
    d = run(o)
    assert d["decision"] == "reject"
    assert "vid_0" in d["reasons"][0]["message"]


def test_missing_check_output_goes_to_review_never_silent_accept() -> None:
    o = good_outputs()
    del o["hands_visible"]
    d = run(o)
    assert d["decision"] == "review"
    assert d["checks"]["hands_visible"]["status"] == "error"


def test_check_error_goes_to_review() -> None:
    o = good_outputs()
    o["task_completed"] = CheckOutput(error="model timeout")
    d = run(o)
    assert d["decision"] == "review"
    assert "model timeout" in d["reasons"][0]["message"]


def test_disabled_check_is_skipped() -> None:
    rubric = copy.deepcopy(RUBRIC)
    rubric["checks"]["framing"] = {"enabled": False}
    o = good_outputs()
    o["framing"] = CheckOutput({"off_target_ratio": 0.9, "unstable_ratio": 0.9})
    d = run(o, rubric)
    assert d["decision"] == "accept"
    assert d["checks"]["framing"]["status"] == "skipped"


def test_reject_reasons_are_listed_before_review_reasons(hands_can_reject: None) -> None:
    o = good_outputs()
    o["framing"] = CheckOutput({"off_target_ratio": 0.3, "unstable_ratio": 0.0})
    o["hands_visible"] = CheckOutput({"ratio_both_manipulation": 0.5})
    d = run(o)
    assert d["decision"] == "reject"
    assert [r["effect"] for r in d["reasons"]] == ["reject", "review"]


def test_skipped_check_adds_no_reason_when_already_rejected(hands_can_reject: None) -> None:
    o = good_outputs()
    o["hands_visible"] = CheckOutput({"ratio_both_manipulation": 0.3})
    o["task_completed"] = CheckOutput(skipped="a critical check already failed")
    d = run(o)
    assert d["decision"] == "reject"
    assert d["checks"]["task_completed"]["status"] == "skipped"
    assert [r["check"] for r in d["reasons"]] == ["hands_visible"]


def test_skip_without_any_reject_goes_to_review() -> None:
    o = good_outputs()
    o["task_completed"] = CheckOutput(skipped="should not happen")
    d = run(o)
    assert d["decision"] == "review"
    assert d["reasons"][0]["code"] == "pipeline.skipped_without_reject"


@pytest.mark.parametrize("duration,code", [(5, "technical.too_short"), (900, "technical.too_long")])
def test_duration_limits(duration: float, code: str) -> None:
    o = good_outputs()
    o["technical"] = CheckOutput({"decodable": True, "duration_s": duration, "width": 1920,
                                  "height": 1080, "fps": 30, "blur_ratio": 0.0,
                                  "bad_exposure_ratio": 0.0})
    d = run(o)
    assert d["decision"] == "reject"
    assert d["reasons"][0]["code"] == code
