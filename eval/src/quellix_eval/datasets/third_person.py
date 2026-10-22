"""The third-person / tripod test set (Pexels, Pexels License).

All our other tests are first-person. This manifest lists clips filmed from a side or front
view, with what Ormes said about each, so we can see the gap. It holds links and results only:
the videos are downloaded when a job needs them and never committed.

`observed` is what the worker returned on the day (an observation, not a label): nobody has
labelled these clips yet, so it must not be used as truth.
"""

from __future__ import annotations

from collections.abc import Iterable
from pathlib import Path
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict

LICENSE = "Pexels License"


class Observed(BaseModel):
    model_config = ConfigDict(extra="forbid")

    decision: Literal["accept", "reject", "review"] | None
    reasons: list[dict[str, Any]] = []
    both_hands_whole: float | None = None      # share of the best window
    both_hands_working: float | None = None
    worker_version: str = ""


class ThirdPersonRecord(BaseModel):
    model_config = ConfigDict(extra="forbid")

    clip_id: str
    source: Literal["pexels"] = "pexels"
    license: Literal["Pexels License"] = LICENSE
    page_url: str
    pexels_id: int
    author: str | None = None
    author_url: str | None = None
    viewpoint: Literal["third_person"] = "third_person"
    orientation: Literal["landscape", "portrait"]
    task: str
    duration_s: float | None = None
    width: int | None = None
    height: int | None = None
    observed: Observed
    truth: None = None                 # nobody has labelled these yet
    notes: str = "viewpoint test set; observed is the worker's output, not a label"


def write_records(records: Iterable[ThirdPersonRecord], path: str | Path) -> int:
    p = Path(path)
    p.parent.mkdir(parents=True, exist_ok=True)
    n = 0
    with p.open("w") as f:
        for r in records:
            f.write(r.model_dump_json() + "\n")
            n += 1
    return n


def load_records(path: str | Path) -> list[ThirdPersonRecord]:
    return [ThirdPersonRecord.model_validate_json(line)
            for line in Path(path).read_text().splitlines() if line.strip()]
