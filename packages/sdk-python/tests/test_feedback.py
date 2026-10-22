import json
from pathlib import Path

import pytest

from ormes import Decision, FeedbackItem, Video, contributor_feedback
from ormes.feedback import GENERIC_HIDDEN_MESSAGE, contributor_visible

EXAMPLES = Path(__file__).resolve().parents[2] / "contracts" / "examples"
DECISION = json.loads((EXAMPLES / "decision.feedback.json").read_text())
EXPECTED = json.loads((EXAMPLES / "decision.feedback.expected.json").read_text())


def _dump(items: list[FeedbackItem]) -> list[dict[str, object]]:
    return [i.model_dump(mode="json") for i in items]


def test_shared_vectors_from_the_contract() -> None:
    decision = Decision.model_validate(DECISION)
    assert _dump(decision.contributor_feedback()) == EXPECTED
    assert _dump(contributor_feedback(DECISION)) == EXPECTED  # raw JSON works too


def test_method_is_available_on_a_video_decision() -> None:
    video = Video.model_validate({
        "id": "v", "status": "decided", "rubric_id": "r", "rubric_version": 1,
        "created_at": "2026-10-22T10:00:00Z", "decision": DECISION,
    })
    assert video.decision is not None
    assert _dump(video.decision.contributor_feedback()) == EXPECTED


@pytest.mark.parametrize("flag", [True, False, None])
def test_duplicates_are_never_visible(flag: bool | None) -> None:
    reason: dict[str, object] = {"check": "originality", "code": "originality.duplicate",
                                 "message": "Matches video abc.", "effect": "reject",
                                 "hint": "x", "segments": [{"start_s": 0, "end_s": 1}]}
    if flag is not None:
        reason["contributor_visible"] = flag
    assert not contributor_visible(reason)
    items = contributor_feedback({"reasons": [reason]})
    assert [i.message for i in items] == [GENERIC_HIDDEN_MESSAGE]
    assert "abc" not in json.dumps(_dump(items))


def test_old_decisions_without_the_new_fields() -> None:
    reasons = [
        {"check": "technical", "code": "technical.too_short", "message": "Short.", "effect": "reject"},
        {"check": "hands_visible", "code": "hands_visible.error", "message": "X.", "effect": "review"},
        {"check": "technical", "code": "pipeline.skipped_without_reject", "message": "Skip.",
         "effect": "review"},
    ]
    items = contributor_feedback({"reasons": reasons})
    assert [(i.code, i.hint, i.segments) for i in items] == [("technical.too_short", None, [])]


def test_hidden_review_only_reason_adds_nothing() -> None:
    items = contributor_feedback({"reasons": [
        {"check": "privacy", "code": "privacy.faces", "message": "Face.", "effect": "review",
         "contributor_visible": False}]})
    assert items == []


def test_rejects_other_types() -> None:
    with pytest.raises(TypeError):
        contributor_feedback(42)
