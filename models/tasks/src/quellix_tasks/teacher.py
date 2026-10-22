"""Bootstrap labels with a general video model (teacher), for people to correct.

    python -m quellix_tasks.teacher --manifest clips.jsonl --out teacher.jsonl --judge gemini

The teacher is a general model (Gemini / TwelveLabs, via the worker's judges), so clips are
sent to a third party: only public-license clips are sent. Customer clips (`customer-opt-in`)
are skipped unless `--org-allows-external` says that organisation allows external models.
Only confident teacher answers become labels, marked `labels_source: baseline` so they are
never mistaken for human truth. Teacher steps become step-time hints in `notes`.
"""

from __future__ import annotations

import argparse
import json
from collections.abc import Sequence
from pathlib import Path
from typing import Any

from quellix_worker.checks.task_baseline import TaskJudge, build_prompt

from .data import PUBLIC_LICENSES, Clip, load_manifest


def may_send(clip: Clip, org_allows_external: bool) -> bool:
    lic = clip.license.lower()
    return lic in PUBLIC_LICENSES or (lic == "customer-opt-in" and org_allows_external)


def label(
    clips: Sequence[Clip], judge: TaskJudge, min_confidence: float = 0.8,
    org_allows_external: bool = False,
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    out: list[dict[str, Any]] = []
    stats = {"sent": 0, "labelled": 0, "unsure": 0, "not_sent": 0, "errors": 0, "cost_usd": 0.0}
    for clip in clips:
        if not may_send(clip, org_allows_external):
            stats["not_sent"] += 1
            continue
        stats["sent"] += 1
        try:
            prompt = build_prompt({"task": clip.task})
            j = judge.judge(clip.path, prompt, clip.raw.get("duration_s"))
        except Exception:  # noqa: BLE001 - one failed call must not stop the batch
            stats["errors"] += 1
            continue
        stats["cost_usd"] += j.cost_usd
        if j.completed is None or j.confidence < min_confidence:
            stats["unsure"] += 1
            continue
        stats["labelled"] += 1
        rec = {**clip.raw,
               "truth": "accept" if j.completed else "reject",
               "checks": {**clip.raw.get("checks", {}),
                          "task_completed": "pass" if j.completed else "fail"},
               "labels_source": "baseline",
               "notes": json.dumps({"teacher": j.model, "confidence": j.confidence,
                                    "steps": list(j.steps)})}
        out.append(rec)
    stats["cost_usd"] = round(stats["cost_usd"], 4)
    return out, stats


def main(argv: list[str] | None = None) -> int:  # pragma: no cover - calls a paid API
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawTextHelpFormatter)
    ap.add_argument("--manifest", type=Path, required=True)
    ap.add_argument("--out", type=Path, required=True)
    ap.add_argument("--judge", choices=["gemini", "twelvelabs"], default="gemini")
    ap.add_argument("--min-confidence", type=float, default=0.8)
    ap.add_argument("--org-allows-external", action="store_true")
    a = ap.parse_args(argv)
    from quellix_worker.checks.task_baseline import GeminiJudge, TwelveLabsJudge

    judge: TaskJudge = GeminiJudge() if a.judge == "gemini" else TwelveLabsJudge()
    records, stats = label(load_manifest(a.manifest), judge, a.min_confidence,
                           a.org_allows_external)
    a.out.write_text("".join(json.dumps(r) + "\n" for r in records))
    print(json.dumps(stats, indent=2))
    return 0


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
