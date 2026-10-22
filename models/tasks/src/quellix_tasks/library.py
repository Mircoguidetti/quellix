"""The task library: tasks collectors record most, each with ordered steps and a final state.

A rubric names a library task with `task.library_id`. The rubric's own `steps` /
`final_state` win when present; the library fills what the rubric leaves out.
"""

from __future__ import annotations

import json
from collections.abc import Mapping
from dataclasses import dataclass
from functools import cache
from importlib import resources
from typing import Any


@dataclass(frozen=True)
class TaskDefinition:
    id: str
    description: str
    steps: tuple[str, ...]
    final_state: str
    family: str


@cache
def library() -> dict[str, TaskDefinition]:
    raw = json.loads(resources.files(__package__).joinpath("library.json").read_text())
    return {t["id"]: TaskDefinition(t["id"], t["description"], tuple(t["steps"]),
                                    t["final_state"], t["family"]) for t in raw["tasks"]}


def resolve_task(task: Mapping[str, Any]) -> TaskDefinition:
    """Merge a rubric `task` object with its library entry (rubric fields win)."""
    lib = library().get(str(task.get("library_id", "")))
    steps = tuple(task.get("steps") or (lib.steps if lib else ()))
    description = str(task.get("description") or (lib.description if lib else ""))
    if not steps:
        # No steps anywhere: the description itself is the one step to find.
        steps = (description,) if description else ()
    return TaskDefinition(
        id=lib.id if lib else "custom",
        description=description,
        steps=steps,
        final_state=str(task.get("final_state") or (lib.final_state if lib else "")),
        family=lib.family if lib else "custom",
    )
