"""``python -m quellix_tasks check <video> --rubric <rubric.json> [--video-id ID] [--report P]``

Same contract as ``python -m quellix_worker check`` so `eval` can run the task model with
``--worker-cmd <models/tasks>/.venv/bin/quellix-tasks``: stdout carries only the decision
JSON; exit code 0 on any decision, 2 on invalid input, 1 on an internal error.

Only `task_completed` is evaluated: every other check is disabled in the rubric copy, so the
decision reflects the task model alone (that is what the eval comparison needs).
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import sys
import time
import uuid
from pathlib import Path
from typing import Any

from quellix_worker.contracts import validate_decision
from quellix_worker.rubric import CHECK_NAMES, evaluate

from .encoder import Encoder, SiglipEncoder
from .head import load_head
from .model import TaskModel
from .video import sample_frames

log = logging.getLogger("quellix_tasks")


def task_only(rubric: dict[str, Any]) -> dict[str, Any]:
    checks = dict(rubric.get("checks", {}))
    for name in CHECK_NAMES:
        if name != "task_completed":
            checks[name] = {**checks.get(name, {}), "enabled": False}
    checks["task_completed"] = {**checks.get("task_completed", {}), "enabled": True}
    return {**rubric, "checks": checks}


def _parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="quellix_tasks")
    sub = p.add_subparsers(dest="cmd", required=True)
    c = sub.add_parser("check", help="Judge task completion on one local video; print a decision")
    c.add_argument("video", type=Path)
    c.add_argument("--rubric", type=Path, required=True)
    c.add_argument("--video-id", default=None)
    c.add_argument("--report", type=Path, default=None)
    c.add_argument("--head", type=Path, default=None, help="trained head JSON (default: "
                   "$QUELLIX_TASKS_HEAD, else the cautious untrained head)")
    return p


def main(argv: list[str] | None = None, encoder: Encoder | None = None) -> int:
    logging.basicConfig(stream=sys.stderr, level=logging.INFO, format="%(levelname)s %(message)s")
    try:
        args = _parser().parse_args(argv)
    except SystemExit as exc:
        return 2 if exc.code else 0
    try:
        if not args.video.is_file():
            raise ValueError(f"video not found: {args.video}")
        rubric = task_only(json.loads(args.rubric.read_text()))
        head = load_head(args.head)
    except (OSError, ValueError, TypeError) as exc:
        log.error("invalid input: %s", exc)
        return 2
    started = time.monotonic()
    try:
        model = TaskModel(encoder or SiglipEncoder(), head)
        frames, times = sample_frames(args.video)
        output = model.run(rubric, frames, times.tolist())
        decision = evaluate(args.video_id or str(uuid.uuid4()), rubric,
                            {"task_completed": output})
        validate_decision(decision)
    except Exception:
        log.exception("internal error")
        return 1
    cost = (time.monotonic() - started) * float(os.environ.get("QUELLIX_COMPUTE_USD_PER_S", 0))
    if args.report:
        args.report.write_text(json.dumps({"decision": decision, "cost_usd": round(cost, 6),
                                           "models": {"task_completed": model.name}}, indent=2))
    json.dump(decision, sys.stdout, indent=2)
    sys.stdout.write("\n")
    return 0


def cli() -> None:
    raise SystemExit(main())


if __name__ == "__main__":
    cli()
