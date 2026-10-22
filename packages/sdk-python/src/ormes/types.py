"""Public model types, generated from packages/contracts/openapi.yaml (see scripts/generate.sh)."""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any, Literal

from pydantic import AwareDatetime, BaseModel, ConfigDict

from ._generated import (
    ContentType,
    CreateVideoRequest,
    CreateVideoResponse,
    DecisionValue,
    LabOutcome,
    Outcome,
    Review,
    RubricInput,
    Video,
    VideoStatus,
)
from ._generated import decision as _decision
from ._generated import rubric as _rubric

Decision = _decision.Schema
Rubric = _rubric.Schema

# The contract types RubricInput.task / checks as bare objects, so any mapping is accepted
# (it is validated by the API). Use `Rubric` for responses.
RubricInputLike = Mapping[str, Any]

__all__ = [
    "ContentType",
    "CreateVideoRequest",
    "CreateVideoResponse",
    "Decision",
    "DecisionValue",
    "LabOutcome",
    "Outcome",
    "Review",
    "Rubric",
    "RubricInput",
    "RubricInputLike",
    "Video",
    "VideoDecidedEvent",
    "VideoStatus",
]


class VideoDecidedEvent(BaseModel):
    """Payload of the `video.decided` webhook."""

    model_config = ConfigDict(extra="allow")

    type: Literal["video.decided"]
    created_at: AwareDatetime
    data: Video
