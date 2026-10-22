"""TaskModel: rubric + decoded video -> the worker's `task_completed` CheckOutput."""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from typing import Any

import numpy as np
from quellix_worker.rubric import CheckOutput

from . import __version__
from .decide import measurements
from .encoder import Encoder, final_state_prompt, step_prompt
from .features import Analysis, analyse
from .head import Head, load_head
from .library import TaskDefinition, resolve_task

MIN_FRAMES = 3


def similarities(
    encoder: Encoder, frame_emb: np.ndarray, steps: Sequence[str], final_state: str
) -> tuple[np.ndarray, np.ndarray | None]:
    """-> (T, K) frame x step cosine similarity, (T,) frame x final state (or None)."""
    texts = [step_prompt(s) for s in steps]
    if final_state:
        texts.append(final_state_prompt(final_state))
    text_emb = encoder.embed_texts(texts)
    sim = frame_emb @ text_emb.T
    if final_state:
        return sim[:, :-1], sim[:, -1]
    return sim, None


class TaskModel:
    def __init__(self, encoder: Encoder, head: Head | None = None) -> None:
        self.encoder = encoder
        self.head = head or load_head()

    @property
    def name(self) -> str:
        return f"tasks@{__version__}+{self.head.version}+{self.encoder.name}"

    def analyse_embeddings(
        self, task_spec: Mapping[str, Any], frame_emb: np.ndarray, times_s: np.ndarray
    ) -> tuple[Analysis, TaskDefinition]:
        task = resolve_task(task_spec)
        if not task.steps:
            raise ValueError("the rubric task has neither steps nor a description")
        step_sim, final_sim = similarities(self.encoder, frame_emb, task.steps, task.final_state)
        return analyse(step_sim, final_sim, times_s), task

    def judge_embeddings(
        self, rubric: Mapping[str, Any], frame_emb: np.ndarray, times_s: np.ndarray
    ) -> dict[str, Any]:
        analysis, task = self.analyse_embeddings(rubric.get("task", {}), frame_emb, times_s)
        m = measurements(analysis, self.head, task.steps, times_s)
        m["library_id"] = task.id
        return m

    def run(
        self, rubric: Mapping[str, Any], frames: Sequence[np.ndarray], times_s: Sequence[float]
    ) -> CheckOutput:
        """Any failure becomes an error (-> review in the worker), never a guess."""
        if len(frames) < MIN_FRAMES:
            return CheckOutput(error=f"too few frames ({len(frames)}) to judge the task",
                               model=self.name)
        try:
            emb = self.encoder.embed_images(frames)
            m = self.judge_embeddings(rubric, emb, np.asarray(times_s, dtype=np.float64))
        except Exception as exc:  # noqa: BLE001 - the decision must still be written
            return CheckOutput(error=f"task model failed: {exc}", model=self.name)
        return CheckOutput(measurements=m, model=self.name)
