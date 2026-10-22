"""Base class of the generated ``Decision`` model (see scripts/generate.sh, --base-class-map)."""

from __future__ import annotations

from pydantic import BaseModel

from .feedback import FeedbackItem, contributor_feedback


class DecisionBase(BaseModel):
    def contributor_feedback(self) -> list[FeedbackItem]:
        """What to fix and where, for the person who filmed the video. See ``ormes.feedback``."""
        return contributor_feedback(self)
