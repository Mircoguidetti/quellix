"""Run one slice of benchmark v2 end to end and write `results.json`.

    python -m quellix_eval.benchmark.runner --slice tasks --sessions 130 --out out/tasks \\
        --budget-usd 1.5

Slices: `tasks` and `hands` (HoloAssist, independent labels), `synthetic` (Egocentric-10K
originals + synthetic defects, reported separately). Engines: the worker (in parallel
processes) and Gemini, cheap model on every clip and strong model on a label-balanced order
until the spend cap stops it. The report is rendered later from every slice's results.json.
"""

from __future__ import annotations

import argparse
import json
import os
import random
import sys
import tempfile
import threading
import time
from collections.abc import Callable, Mapping, Sequence
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import httpx

from ..baselines.retry import is_billing_problem, is_hard_quota, is_rate_limit, retry_delay_s
from ..datasets.manifest import ClipRecord, write_manifest
from ..run import rubric_for, worker_engine
from . import holo
from .gemini_v2 import (
    CHEAP_MODEL,
    STRONG_MODEL,
    Budget,
    SpendCapReached,
    StructuredClient,
    judge,
)

RUBRICS = Path(__file__).resolve().parents[3] / "rubrics"
SLICE_RUBRIC = {"tasks": "benchmark_v2_tasks.json", "hands": "benchmark_v2_hands.json",
                "synthetic": "eval_v0.json"}
OVERLAYS = 12   # hands slice: frames with the projected joints drawn, to check labels by eye
# Each model gets its own share of a job's cap, so the strong model cannot starve the cheap one
# (run 39783934037: the strong model used 86% of a shared cap, the cheap one covered half).
MODEL_SHARE = {CHEAP_MODEL: 0.3, STRONG_MODEL: 0.7}
# Rough first-call guesses (USD per clip at low media resolution) until a real cost is seen.
FIRST_GUESS = {CHEAP_MODEL: 0.003, STRONG_MODEL: 0.06}


@dataclass
class ClipResult:
    decision: str | None = None
    checks: dict[str, str] = field(default_factory=dict)
    error: str | None = None
    not_run: bool = False
    cost_usd: float = 0.0
    latency_s: float | None = None


def summarise(decision: Mapping[str, Any] | None) -> tuple[str | None, dict[str, str]]:
    if not decision:
        return None, {}
    return decision.get("decision"), {
        k: v.get("status", "missing") for k, v in decision.get("checks", {}).items()}


# --- clips ---------------------------------------------------------------------------------


def holo_clips(kind: str, sessions_n: int, work: Path, seed: int,
               remote: holo.Remote, client: httpx.Client) -> tuple[list[ClipRecord], dict]:
    ann_path = work / "annotations.json"
    if not ann_path.exists():
        ann_path.write_bytes(client.get(holo.ANNOTATIONS_URL).raise_for_status().content)
    ann = holo.load_annotations(json.loads(ann_path.read_text()))
    splits = holo.load_splits(client.get(holo.SPLITS_URL).raise_for_status().content)
    val = [s for s in splits.get("val", []) if s in ann]
    vreader, vidx = remote.videos()
    stats: dict[str, Any] = {"val_sessions_annotated": len(val), "skipped": {}}

    def skip(why: str) -> None:
        stats["skipped"][why] = stats["skipped"].get(why, 0) + 1

    rng = random.Random(seed)
    clips: list[ClipRecord] = []
    for session in holo.pick_sessions(val, sessions_n, seed):
        member = holo.member_for(vidx, session, "Video_pitchshift.mp4")
        if member is None:
            skip("video not in the release tar")
            continue
        vis = None
        if kind == "hands":
            try:
                vis = holo.session_visibility(remote, session)
            except Exception as e:  # noqa: BLE001 - one broken session must not stop the run
                print(f"hands {session}: {e}", file=sys.stderr)
            if vis is None:
                skip("hand pose or camera files missing")
                continue
        with tempfile.TemporaryDirectory(dir=work) as td:
            src = Path(td) / "video.mp4"
            vreader.copy_to(member.offset, member.size, src)
            try:
                if kind == "tasks":
                    recs = holo.task_clips(session, ann[session], src, work / "clips")
                    if not recs:
                        skip("no fine-grained actions")
                    clips += recs
                else:
                    assert vis is not None
                    rec = holo.hands_clip(session, ann[session], src, vis, work / "clips", rng)
                    if rec is not None and stats.setdefault("overlays", 0) < OVERLAYS:
                        meta = json.loads(rec.notes)
                        a, b = meta["window_s"]
                        stats["overlays"] += holo.overlay(
                            src, vis, (a + b) / 2, work.parent / "debug" / f"{session}.jpg",
                            f"{session} ratio={meta['both_visible_ratio']} "
                            f"label={rec.checks['hands_visible']}")
                    if rec is None:
                        skip("no window with enough manipulation")
                    elif rec.checks["hands_visible"] == "unknown":
                        skip("hands ratio between 0.75 and 0.85 (ambiguous label)")
                        Path(rec.path).unlink(missing_ok=True)
                    else:
                        clips.append(rec)
            except Exception as e:  # noqa: BLE001
                print(f"{kind} {session}: {e}", file=sys.stderr)
                skip("video could not be cut")
    return clips, stats


def synthetic_clips(  # pragma: no cover - network
    n_sources: int, work: Path
) -> tuple[list[ClipRecord], dict]:
    from ..ci import _hf_source, build_eval_manifest
    from ..datasets.manifest import load_manifest

    src = work / "sources.jsonl"
    _hf_source(src, work / "sources", n_sources)
    return build_eval_manifest(load_manifest(src), work / "variants"), {}


# --- engines -------------------------------------------------------------------------------


def balanced_order(clips: Sequence[ClipRecord]) -> list[ClipRecord]:
    """Alternate truths so a run cut short by the spend cap still has both kinds of clip."""
    acc = [c for c in clips if c.truth == "accept"]
    rej = [c for c in clips if c.truth == "reject"]
    out: list[ClipRecord] = []
    while acc or rej:
        if rej:
            out.append(rej.pop(0))
        if acc:
            out.append(acc.pop(0))
    return out


def run_gemini(client: StructuredClient, budget: Budget, clips: Sequence[ClipRecord],
               rubric: Mapping[str, Any], deadline: float, interval_s: float = 6.0,
               sleep: Callable[[float], None] = time.sleep,
               clock: Callable[[], float] = time.monotonic) -> dict[str, ClipResult]:
    out: dict[str, ClipResult] = {}
    stop: str | None = None
    last = float("-inf")
    for clip in clips:
        if stop is None and clock() >= deadline:
            stop = "time budget"
        if stop:
            out[clip.clip_id] = ClipResult(error=f"{stop} reached", not_run=True)
            continue
        t0 = clock()
        res = ClipResult()
        for attempt in range(5):
            wait = last + interval_s - clock()
            if wait > 0:
                sleep(wait)
            last = clock()
            try:
                decision, cost = judge(client, budget, Path(clip.path),
                                       rubric_for(rubric, clip), clip.clip_id)
                res.decision, res.checks = summarise(decision)
                res.cost_usd = cost
                break
            except SpendCapReached as e:
                stop = str(e)
                res = ClipResult(error=str(e), not_run=True)
                break
            except Exception as e:  # noqa: BLE001 - one failed call is a failed clip
                if is_billing_problem(e) or (is_rate_limit(e) and is_hard_quota(e)):
                    stop = f"{client.name}: {str(e)[:120]}"
                    res = ClipResult(error=stop, not_run=True)
                    break
                if is_rate_limit(e) and attempt < 4 and clock() < deadline:
                    sleep(retry_delay_s(e) or 15.0 * 2 ** attempt)
                    continue
                res = ClipResult(error=f"{client.name}: {str(e)[:200]}")
                break
        res.latency_s = clock() - t0
        out[clip.clip_id] = res
    return out


def run_worker(clips: Sequence[ClipRecord], rubric: Mapping[str, Any], deadline: float,
               parallel: int, cmd: Sequence[str] | None = None) -> dict[str, ClipResult]:
    engine = worker_engine(cmd)
    out: dict[str, ClipResult] = {}
    lock = threading.Lock()

    def one(clip: ClipRecord) -> None:
        if time.monotonic() >= deadline:
            res = ClipResult(error="time budget reached", not_run=True)
        else:
            t0 = time.monotonic()
            r = engine(clip, rubric_for(rubric, clip))
            d, checks = summarise(r.decision)
            res = ClipResult(d, checks, r.error, cost_usd=r.cost_usd,
                             latency_s=time.monotonic() - t0)
        with lock:
            out[clip.clip_id] = res

    with ThreadPoolExecutor(max_workers=max(1, parallel)) as pool:
        list(pool.map(one, clips))
    return out


def run_slice(
    name: str, clips: Sequence[ClipRecord], rubric: Mapping[str, Any], budget: Budget,
    deadline: float, parallel: int, gemini: Mapping[str, StructuredClient],
    worker_cmd: Sequence[str] | None = None, interval_s: float = 6.0,
) -> dict[str, dict[str, ClipResult]]:
    """Worker and each Gemini model run concurrently (CPU vs network)."""
    results: dict[str, dict[str, ClipResult]] = {}
    threads = []

    def go(engine: str, fn: Callable[[], dict[str, ClipResult]]) -> None:
        results[engine] = fn()

    threads.append(threading.Thread(target=go, args=("worker", lambda: run_worker(
        clips, rubric, deadline, parallel, worker_cmd))))
    for model, client in gemini.items():
        order = balanced_order(clips) if model == STRONG_MODEL else list(clips)
        def gem(c: StructuredClient = client, o: list[ClipRecord] = order) -> dict[str, ClipResult]:
            return run_gemini(c, budget, o, rubric, deadline, interval_s)

        threads.append(threading.Thread(target=go, args=(f"gemini:{model}", gem)))
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    return results


def write_results(path: Path, name: str, rubric: Mapping[str, Any], clips: Sequence[ClipRecord],
                  results: Mapping[str, Mapping[str, ClipResult]], budget: Budget,
                  stats: Mapping[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps({
        "slice": name,
        "rubric": rubric,
        "clips": [c.model_dump() for c in clips],
        "engines": {e: {cid: vars(r) for cid, r in res.items()} for e, res in results.items()},
        "spend": {"cap_usd": budget.cap_usd, "spent_usd": round(budget.spent_usd, 4),
                  "by_model": {k: round(v, 4) for k, v in budget.by_model.items()},
                  "calls": budget.calls, "refused": budget.refused},
        "stats": stats,
    }, indent=1, default=str))


def main(argv: Sequence[str] | None = None) -> int:  # pragma: no cover - network
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawTextHelpFormatter)
    ap.add_argument("--slice", choices=sorted(SLICE_RUBRIC), required=True)
    ap.add_argument("--sessions", type=int, default=130, help="HoloAssist sessions / sources")
    ap.add_argument("--out", type=Path, required=True)
    ap.add_argument("--budget-usd", type=float, default=1.0)
    ap.add_argument("--minutes", type=float, default=200, help="time budget for the engines")
    ap.add_argument("--parallel", type=int, default=2)
    ap.add_argument("--seed", type=int, default=64)
    ap.add_argument("--models", nargs="*", default=[CHEAP_MODEL, STRONG_MODEL])
    a = ap.parse_args(argv)
    started = time.monotonic()
    work = a.out / "work"
    work.mkdir(parents=True, exist_ok=True)
    client = httpx.Client(timeout=300, follow_redirects=True)
    if a.slice == "synthetic":
        clips, stats = synthetic_clips(a.sessions, work)
    else:
        remote = holo.Remote(Path(os.environ.get("QUELLIX_HOLO_CACHE", a.out / "cache")), client)
        clips, stats = holo_clips(a.slice, a.sessions, work, a.seed, remote, client)
    stats["clip_build_minutes"] = round((time.monotonic() - started) / 60, 1)
    write_manifest(clips, a.out / "manifest.jsonl")
    rubric = json.loads((RUBRICS / SLICE_RUBRIC[a.slice]).read_text())
    budget = Budget(a.budget_usd, FIRST_GUESS,
                    model_caps={m: a.budget_usd * MODEL_SHARE.get(m, 1.0) for m in a.models})
    gemini: dict[str, StructuredClient] = {}
    if os.environ.get("GEMINI_API_KEY"):
        from .gemini_v2 import GeminiStructuredClient

        gemini = {m: GeminiStructuredClient(m) for m in a.models}
    else:
        stats["gemini"] = "skipped: GEMINI_API_KEY is not set"
    deadline = started + a.minutes * 60
    results = run_slice(a.slice, clips, rubric, budget, deadline, a.parallel, gemini)
    stats["total_minutes"] = round((time.monotonic() - started) / 60, 1)
    write_results(a.out / "results.json", a.slice, rubric, clips, results, budget, stats)
    print(json.dumps({"slice": a.slice, "clips": len(clips), "spent_usd": budget.spent_usd,
                      **{k: v for k, v in stats.items() if k != "skipped"}}, indent=1))
    return 0


if __name__ == "__main__":  # pragma: no cover
    sys.exit(main())
