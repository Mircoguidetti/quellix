"""``python -m quellix_worker check <video> --rubric <rubric.json> [--video-id ID] [--report P]``

Contract (shared with `eval`): stdout carries only the decision JSON; logs go to stderr;
exit code 0 on any decision (accept, reject or review), 2 on invalid input, 1 on an
internal error.
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import sys
import uuid
from pathlib import Path

import jsonschema

from .pipeline import Dependencies, PipelineConfig, run_pipeline

log = logging.getLogger("quellix_worker")


def _parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="quellix_worker")
    sub = p.add_subparsers(dest="cmd", required=True)
    c = sub.add_parser("check", help="Run the pipeline on one local video; print the decision")
    c.add_argument("video", type=Path)
    c.add_argument("--rubric", type=Path, required=True)
    c.add_argument("--video-id", default=None)
    c.add_argument("--report", type=Path, default=None,
                   help="also write {decision, cost_usd, timings_ms, models} to this path")
    c.add_argument("--sample-fps", type=float, default=PipelineConfig.sample_fps)
    c.add_argument("--fingerprint-db", type=Path,
                   default=os.environ.get("QUELLIX_FINGERPRINT_DB") or None,
                   help="local file that keeps fingerprints across runs (eval / local use); "
                        "defaults to $QUELLIX_FINGERPRINT_DB")
    c.add_argument("--org-id", default="local", help="fingerprints are matched within one org")
    c.add_argument("--task-model", choices=["none", "gemini", "twelvelabs"], default="none",
                   help="general model for task_completed; sends the video to a third party")
    return p


def main(argv: list[str] | None = None) -> int:
    logging.basicConfig(stream=sys.stderr, level=logging.INFO, format="%(levelname)s %(message)s")

    try:
        args = _parser().parse_args(argv)
    except SystemExit as exc:  # argparse already printed to stderr
        return 2 if exc.code else 0
    try:
        if not args.video.is_file():
            raise ValueError(f"video not found: {args.video}")
        rubric = json.loads(args.rubric.read_text())
    except (OSError, ValueError) as exc:
        log.error("invalid input: %s", exc)
        return 2
    try:
        deps = Dependencies()
        store = None
        if args.fingerprint_db:
            from .checks.originality import FileFingerprintStore
            store = FileFingerprintStore(args.fingerprint_db)
            deps.fingerprints = store
        if args.task_model == "gemini":
            from .checks.task_baseline import GeminiJudge
            deps.task_judge = GeminiJudge()
        elif args.task_model == "twelvelabs":
            from .checks.task_baseline import TwelveLabsJudge
            deps.task_judge = TwelveLabsJudge()
        config = PipelineConfig(sample_fps=args.sample_fps,
                                allow_external_models=args.task_model != "none",
                                org_id=args.org_id)
        video_id = args.video_id or str(uuid.uuid4())
        result = run_pipeline(args.video, rubric, video_id, config, deps)
        if store is not None and result.fingerprints:
            store.add(args.org_id, video_id, result.fingerprints)
            store.save()
    except jsonschema.ValidationError as exc:
        log.error("invalid rubric: %s", exc.message)
        return 2
    except Exception:
        log.exception("internal error")
        return 1
    if args.report:
        args.report.write_text(json.dumps({
            "decision": result.decision, "cost_usd": result.cost["total_usd"],
            "timings_ms": result.timings_ms, "models": result.models}, indent=2))
    json.dump(result.decision, sys.stdout, indent=2)
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
