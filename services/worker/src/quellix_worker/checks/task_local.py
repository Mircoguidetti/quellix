"""Task completion with our own model (``quellix_tasks``), only when a trained head is set.

``QUELLIX_TASKS_HEAD`` must point to a head file produced by ``quellix_tasks.train`` and
``quellix_tasks`` (with its SigLIP encoder dependencies) must be installed. Without that the
worker keeps its previous behaviour: an external judge only if the organisation allows it,
else an error that sends the video to review. The model abstains (``completed: null``) on
anything unclear, which the rubric turns into review, so it never accepts on doubt.
"""

from __future__ import annotations

import logging
import os
from collections.abc import Mapping
from functools import lru_cache
from pathlib import Path
from typing import Any, Protocol

from ..media import DecodedVideo
from ..rubric import CheckOutput

log = logging.getLogger(__name__)

# quellix_tasks samples at 1 fps; the worker's frames are denser.
TASK_SAMPLE_FPS = 1.0


class TaskModel(Protocol):
    def run(self, rubric: Mapping[str, Any], frames: Any, times_s: Any) -> CheckOutput: ...


@lru_cache(maxsize=1)
def configured_model() -> TaskModel | None:
    head = os.environ.get("QUELLIX_TASKS_HEAD")
    if not head or not Path(head).is_file():
        return None
    try:
        from quellix_tasks.encoder import SiglipEncoder
        from quellix_tasks.head import load_head
        from quellix_tasks.model import TaskModel as QuellixTaskModel

        return QuellixTaskModel(SiglipEncoder(), load_head(head))
    except Exception:  # not installed / no weights: fall back, never crash at import
        log.exception("QUELLIX_TASKS_HEAD is set but the task model could not start")
        return None


def run(model: TaskModel, rubric: Mapping[str, Any], video: DecodedVideo) -> CheckOutput:
    """Any failure becomes an error (-> review), never a guess."""
    step = max(1, round(video.sample_fps / TASK_SAMPLE_FPS))
    frames = video.frames[::step]
    try:
        return model.run(rubric, [f.rgb for f in frames], [f.t_s for f in frames])
    except Exception as exc:
        return CheckOutput(error=f"task model failed: {exc}")
