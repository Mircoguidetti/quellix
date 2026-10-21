"""Run engines on a manifest and print the report, side by side.

    python -m quellix_eval.run --manifest m.jsonl --engine worker --engine gemini

Engines: `worker` (our pipeline, through its CLI), `gemini`, `twelvelabs` (general-model
baselines, decided with the worker's own rubric.evaluate).

Worker CLI interface (defined here; the worker folder implements it):

    python -m quellix_worker check VIDEO --rubric RUBRIC.json --video-id ID --report REPORT.json

stdout: only the decision JSON (decision.schema.json); logs on stderr. `--report` writes
{"decision": {...}, "cost_usd": float, "timings_ms": {...}, "models": {...}}. Exit code 0 for
any decision, 2 invalid input, 1 internal error. A non-zero exit, invalid JSON or a missing
report counts as a failed run, which is scored as `review` (never a silent accept/reject).
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
import tempfile
import time
from collections import defaultdict
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import av

from .baselines.common import VideoModelClient, run_baseline
from .datasets.manifest import ClipRecord, load_manifest
from .metrics import Costs, Prediction, Report, report

DEFAULT_RUBRIC = (
    Path(__file__).resolve().parents[3] / "packages" / "contracts" / "examples"
    / "rubric.load_dishwasher.json"
)
ENGINES = ("worker", "gemini", "twelvelabs")


@dataclass(frozen=True)
class EngineResult:
    decision: dict[str, Any] | None   # None = the engine failed on this clip
    cost_usd: float = 0.0
    error: str | None = None


Engine = Callable[[ClipRecord, Mapping[str, Any]], EngineResult]


def rubric_for(base: Mapping[str, Any], clip: ClipRecord) -> dict[str, Any]:
    """The base rubric with the clip's own task."""
    return {**base, "task": {**base.get("task", {}), **clip.task.model_dump()}}


def worker_engine(cmd: Sequence[str] | None = None, timeout_s: float = 600) -> Engine:
    base_cmd = list(cmd) if cmd else [sys.executable, "-m", "quellix_worker"]

    def run(clip: ClipRecord, rubric: Mapping[str, Any]) -> EngineResult:
        with tempfile.TemporaryDirectory() as td:
            rp = Path(td) / "rubric.json"
            rp.write_text(json.dumps(rubric))
            report_path = Path(td) / "report.json"
            argv = [*base_cmd, "check", clip.path, "--rubric", str(rp),
                    "--video-id", clip.clip_id, "--report", str(report_path)]
            try:
                proc = subprocess.run(argv, capture_output=True, text=True, timeout=timeout_s)
            except (OSError, subprocess.TimeoutExpired) as e:
                return EngineResult(None, error=f"worker: {e}")
            if proc.returncode != 0:
                tail = proc.stderr[-200:]
                return EngineResult(None, error=f"worker exit {proc.returncode}: {tail}")
            try:
                decision = json.loads(proc.stdout)
                cost = 0.0
                if report_path.exists():
                    cost = float(json.loads(report_path.read_text()).get("cost_usd", 0.0))
                return EngineResult(decision, cost)
            except (ValueError, AttributeError, TypeError) as e:
                return EngineResult(None, error=f"worker output invalid: {e}")

    return run


def baseline_engine(client: VideoModelClient) -> Engine:
    def run(clip: ClipRecord, rubric: Mapping[str, Any]) -> EngineResult:
        try:
            r = run_baseline(client, Path(clip.path), rubric, clip.clip_id)
        except Exception as e:  # noqa: BLE001 - one bad API call must not stop the run
            return EngineResult(None, error=f"{client.name}: {e}")
        return EngineResult(r.decision, r.cost_usd)

    return run


def make_engine(name: str, worker_cmd: Sequence[str] | None = None) -> Engine:  # pragma: no cover
    if name == "worker":
        return worker_engine(worker_cmd)
    if name == "gemini":
        from .baselines.gemini import GeminiClient

        return baseline_engine(GeminiClient())
    if name == "twelvelabs":
        from .baselines.twelvelabs import TwelveLabsClient

        return baseline_engine(TwelveLabsClient())
    raise ValueError(f"unknown engine {name!r}")


def video_duration_s(clip: ClipRecord) -> float:
    if clip.duration_s:
        return clip.duration_s
    try:
        with av.open(clip.path) as c:
            return float(c.duration / 1_000_000) if c.duration else 0.0
    except Exception:  # noqa: BLE001
        return 0.0


@dataclass
class EngineRun:
    name: str
    report: Report
    confusion: dict[str, dict[tuple[str, str], int]]   # check -> (expected, got) -> n
    cost_usd: float
    video_hours: float
    failures: int

    @property
    def cost_per_hour(self) -> float | None:
        return self.cost_usd / self.video_hours if self.video_hours else None


def evaluate_engine(
    name: str,
    engine: Engine,
    clips: Sequence[ClipRecord],
    base_rubric: Mapping[str, Any],
    costs: Costs | None = None,
) -> EngineRun:
    pairs: list[tuple[Prediction, Any]] = []
    confusion: dict[str, dict[tuple[str, str], int]] = defaultdict(lambda: defaultdict(int))
    cost = hours = 0.0
    failures = 0
    for clip in clips:
        res = engine(clip, rubric_for(base_rubric, clip))
        cost += res.cost_usd
        hours += video_duration_s(clip) / 3600
        if res.decision is None:
            failures += 1
            pairs.append(("review", clip.truth))   # a failed run is never a silent accept/reject
            continue
        pairs.append((res.decision["decision"], clip.truth))
        for check, expected in clip.checks.items():
            if expected == "unknown":
                continue
            status = res.decision.get("checks", {}).get(check, {}).get("status", "missing")
            got = status if status in ("pass", "fail") else "uncertain"
            confusion[check][(expected, got)] += 1
    return EngineRun(name, report(pairs, costs), {k: dict(v) for k, v in confusion.items()},
                     cost, hours, failures)


def _f(x: float | None) -> str:
    return "n/a" if x is None else f"{x:.3f}"


def format_runs(runs: Sequence[EngineRun]) -> str:
    base = runs[0].report
    lines = [
        f"clips: {base.n}   base reject rate: {base.base_reject_rate:.3f}",
        "",
        f"{'metric':<22}" + "".join(f"{r.name:>14}" for r in runs),
    ]
    rows: list[tuple[str, Callable[[EngineRun], str]]] = [
        ("base reject rate", lambda r: _f(r.report.base_reject_rate)),
        ("reject precision", lambda r: _f(r.report.reject_precision)),
        ("reject recall", lambda r: _f(r.report.reject_recall)),
        ("flag recall", lambda r: _f(r.report.flag_recall)),
        ("false reject rate", lambda r: _f(r.report.false_reject_rate)),
        ("false accept rate", lambda r: _f(r.report.false_accept_rate)),
        ("review rate", lambda r: _f(r.report.review_rate)),
        ("cost saving vs human", lambda r: _f(r.report.cost_saving)),
        ("cost USD / video hour", lambda r: _f(r.cost_per_hour)),
        ("failed runs", lambda r: str(r.failures)),
    ]
    for label, fn in rows:
        lines.append(f"{label:<22}" + "".join(f"{fn(r):>14}" for r in runs))
    for r in runs:
        lines += ["", f"per-check confusion [{r.name}] (expected -> got: n)"]
        for check, cells in sorted(r.confusion.items()):
            body = ", ".join(f"{e}->{g}: {n}" for (e, g), n in sorted(cells.items()))
            lines.append(f"  {check:<16}{body}")
    return "\n".join(lines)


def main(argv: Sequence[str] | None = None, engines: Mapping[str, Engine] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawTextHelpFormatter)
    ap.add_argument("--manifest", type=Path, required=True)
    ap.add_argument("--engine", action="append", choices=ENGINES, required=True)
    ap.add_argument("--rubric", type=Path, default=DEFAULT_RUBRIC)
    ap.add_argument("--worker-cmd", nargs="+", help="override the worker CLI command")
    ap.add_argument("--limit", type=int)
    a = ap.parse_args(argv)

    clips = load_manifest(a.manifest)[: a.limit]
    rubric = json.loads(a.rubric.read_text())
    runs = []
    for name in a.engine:
        t0 = time.time()
        engine = engines[name] if engines and name in engines else make_engine(name, a.worker_cmd)
        runs.append(evaluate_engine(name, engine, clips, rubric))
        print(f"[{name}] done in {time.time() - t0:.1f}s", file=sys.stderr)
    print(format_runs(runs))
    return 0


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
