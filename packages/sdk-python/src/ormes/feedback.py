"""Contributor feedback: what to fix and where, ready to show to the person who filmed the video.

The rule (shared with the TypeScript SDK and the web app; test vectors in
``packages/contracts/examples/decision.feedback*.json``):

- keep only reasons the contributor may see (``contributor_visible``). Absent means visible,
  except ``originality.*`` (never visible, whatever the flag says), ``*.error`` and ``pipeline.*``;
- order by the start of the first segment; reasons about the whole video come last;
- hidden reasons that reject collapse into one generic item, so a contributor never learns why a
  duplicate was caught; hidden reasons that only send the video to review are dropped.
"""

from __future__ import annotations

import math
from collections.abc import Mapping
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict

GENERIC_HIDDEN_MESSAGE = (
    "This video could not be accepted for a reason we cannot share. "
    "Ask the company that paid you for details."
)


class FeedbackSegment(BaseModel):
    model_config = ConfigDict(frozen=True)

    start_s: float
    end_s: float


class FeedbackItem(BaseModel):
    """One message for the contributor. ``check`` and ``code`` are None for the generic item."""

    model_config = ConfigDict(frozen=True)

    check: str | None
    code: str | None
    effect: Literal["reject", "review"]
    message: str
    hint: str | None
    segments: list[FeedbackSegment]


def contributor_visible(reason: Mapping[str, Any]) -> bool:
    check = str(reason.get("check", ""))
    code = str(reason.get("code", ""))
    if check == "originality" or code.startswith("originality."):
        return False
    flag = reason.get("contributor_visible")
    if isinstance(flag, bool):
        return flag
    return not (code.endswith(".error") or code.startswith("pipeline."))


def _plain(decision: Any) -> Mapping[str, Any]:
    if isinstance(decision, BaseModel):
        return decision.model_dump(mode="json")
    if isinstance(decision, Mapping):
        return decision
    raise TypeError(f"expected a decision model or mapping, got {type(decision).__name__}")


def contributor_feedback(decision: Any) -> list[FeedbackItem]:
    """Feedback for a decision (an ``ormes.Decision`` or the raw JSON mapping)."""
    reasons = _plain(decision).get("reasons") or []
    shown: list[tuple[float, int, FeedbackItem]] = []
    hidden_reject = False
    for i, r in enumerate(reasons):
        effect = r.get("effect")
        if not contributor_visible(r):
            hidden_reject = hidden_reject or effect == "reject"
            continue
        segments = [FeedbackSegment(start_s=float(s["start_s"]), end_s=float(s["end_s"]))
                    for s in (r.get("segments") or [])]
        start = min((s.start_s for s in segments), default=math.inf)
        item = FeedbackItem(check=r.get("check"), code=r.get("code"),
                            effect="reject" if effect == "reject" else "review",
                            message=r.get("message", ""), hint=r.get("hint") or None,
                            segments=segments)
        shown.append((start, i, item))
    out = [item for _, _, item in sorted(shown, key=lambda x: (x[0], x[1]))]
    if hidden_reject:
        out.append(FeedbackItem(check=None, code=None, effect="reject",
                                message=GENERIC_HIDDEN_MESSAGE, hint=None, segments=[]))
    return out
