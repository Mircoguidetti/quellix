"""First real evaluation, built to run on GitHub Actions.

    python -m quellix_eval.ci --clips 20 --out-dir eval/out

Pipeline: stream N short clips of Egocentric-10K -> manifest -> synthetic defects (3 variants
per clip, round-robin) -> worker engine -> `report.md` (also appended to $GITHUB_STEP_SUMMARY).

Gemini (cheapest Flash-Lite, free tier, public clips only) runs on the same manifest when
GEMINI_API_KEY is set; otherwise the report says it was skipped.

Source clips are ASSUMED acceptable: nobody reviewed them, so any rejection of an original is
a mix of worker error and genuinely bad source footage. Hands and task are not evaluated.
"""

from __future__ import annotations

import argparse
import dataclasses
import json
import os
import re
import shutil
import sys
import time
from collections import Counter
from collections.abc import Callable, Mapping, Sequence
from pathlib import Path
from typing import Any

from .baselines.common import VideoModelClient
from .baselines.fallback import FallbackClient
from .baselines.retry import RetryingClient
from .datasets import egocentric10k
from .datasets.manifest import ClipRecord, load_manifest, write_manifest
from .defects.build import build_variants
from .prices import gemini_models_by_price
from .privacy_report import contact_sheet, privacy_breakdown
from .run import (
    Engine,
    EngineResult,
    EngineRun,
    baseline_engine,
    evaluate_engine,
    format_runs,
    worker_engine,
)

DEFAULT_RUBRIC = Path(__file__).resolve().parents[2] / "rubrics" / "eval_v0.json"
CI_VARIANTS = (
    "blur", "underexposed", "overexposed", "document", "face", "screen",
    "dup_reencode", "dup_crop", "dup_mirror", "dup_speed", "dup_trim",
)
VARIANTS_PER_CLIP = 3
DEFAULT_CLIPS = 40
MIN_FACTORIES = 8
GEMINI_SUBSET_SOURCES = 20     # Gemini sees 20 originals + their variants (80 clips)
GEMINI_BUDGET_S = 18 * 60      # whole run must stay well under 45 minutes
GEMINI_INTERVAL_S = 6.0        # 10 requests per minute, inside the free tier

# Builds a manifest of source clips: (out_manifest, data_dir, n_clips) -> n written
SourceBuilder = Callable[[Path, Path, int], int]


def pick_variants(index: int, per_clip: int = VARIANTS_PER_CLIP) -> list[str]:
    """Round-robin so a small run still covers every defect kind."""
    return [CI_VARIANTS[(index * per_clip + j) % len(CI_VARIANTS)] for j in range(per_clip)]


def label_sources(records: Sequence[ClipRecord]) -> list[ClipRecord]:
    """Assumed per-check labels for the unreviewed originals."""
    return [
        r.model_copy(update={"checks": {"technical": "pass", "privacy": "pass",
                                        "originality": "pass"}})
        for r in records
    ]


def build_eval_manifest(
    sources: Sequence[ClipRecord], variants_dir: Path, per_clip: int = VARIANTS_PER_CLIP
) -> list[ClipRecord]:
    """Originals first (so duplicates find them in the fingerprint store), then variants."""
    originals = label_sources(sources)
    out: list[ClipRecord] = list(originals)
    for i, rec in enumerate(originals):
        for rv in build_variants([rec], variants_dir, pick_variants(i, per_clip))[1:]:
            if "__dup_" not in rv.clip_id:
                # A blurred / darkened / overlaid copy IS a near-duplicate of its source for the
                # fingerprint, so what originality should say here is not known.
                rv = rv.model_copy(update={"checks": {**rv.checks, "originality": "unknown"}})
            out.append(rv)
    return out


def _md_table(header: Sequence[str], rows: Sequence[Sequence[str]]) -> list[str]:
    lines = ["| " + " | ".join(header) + " |", "|" + "---|" * len(header)]
    lines += ["| " + " | ".join(r) + " |" for r in rows]
    return lines


def check_metrics(cells: Mapping[tuple[str, str], int]) -> dict[str, float | None]:
    """Reject precision / recall / flag recall / review rate for one check.

    defect = expected fail; caught = got fail; uncertain (uncertain, error, skipped) is a
    "review" for this check; a defect that is uncertain is flagged but not rejected.
    """
    caught, missed, unc_d = cells.get(("fail", "fail"), 0), cells.get(("fail", "pass"), 0), \
        cells.get(("fail", "uncertain"), 0)
    alarm, ok, unc_p = cells.get(("pass", "fail"), 0), cells.get(("pass", "pass"), 0), \
        cells.get(("pass", "uncertain"), 0)
    defects, total = caught + missed + unc_d, caught + missed + unc_d + alarm + ok + unc_p

    def ratio(a: float, b: float) -> float | None:
        return a / b if b else None

    return {
        "precision": ratio(caught, caught + alarm),
        "recall": ratio(caught, defects),
        "flag_recall": ratio(caught + unc_d, defects),
        "review_rate": ratio(unc_d + unc_p, total),
        "base_rate": ratio(defects, total),
    }


def _p(x: float | None) -> str:
    return "n/a" if x is None else f"{x:.2f}"


def _factories(clips: Sequence[ClipRecord]) -> int:
    return len({m.group(0) for c in clips if (m := re.search(r"factory_\d+", c.notes))})


def _count_line(requested: int | None, n_src: int, total: int) -> str:
    asked = "" if requested is None else f"requested **{requested}**, "
    line = f"**Source clips: {asked}got {n_src}** ({total} clips with synthetic defects)."
    if requested is not None and n_src < requested:
        line += f" **WARNING: {requested - n_src} fewer than requested.**"
    return line


def render_report(
    runs: Sequence[EngineRun],
    clips: Sequence[ClipRecord],
    notes: Sequence[str | Callable[[], str]] = (),
    requested: int | None = None,
) -> str:
    n_src = sum(1 for c in clips if "__" not in c.clip_id)
    factories = _factories(clips)
    lines = [
        "# Quellix eval: worker vs. general model",
        "",
        _count_line(requested, n_src, len(clips)),
        "",
        "## Read this first",
        f"- **{n_src} source clips** from Build AI Egocentric-10K (Apache 2.0)"
        + (f", from {factories} factories" if factories else "")
        + ", transcoded to short low-res clips. They are **assumed acceptable**: nobody "
        "reviewed them. A reject on an original may be the engine's mistake or genuinely bad "
        "footage (faces, screens or documents really in view).",
        f"- **{len(clips) - n_src} synthetic defect clips**, labelled by construction "
        "(blur, exposure, overlays, duplicates).",
        "- **Checks that are OFF:** hands visibility and task completion (no real labels yet). "
        "Evaluated: technical, privacy, originality. Framing is on but has no labels.",
        "- Labels that are not known are excluded per check (counts below).",
        "- The base reject rate is set by how many defects we generated, not by real traffic: "
        "these numbers show detection ability, not production performance.",
        "- Gemini does not see a fingerprint store, so it cannot catch duplicates by design.",
    ]
    lines += [f"- **{text}**" for n in notes if (text := n() if callable(n) else n)]

    lines += ["", "## Per check, side by side",
              "precision / recall / flag recall / review rate (share of this check's clips that "
              "ended uncertain). Base rate = share of clips with an expected fail.", ""]
    checks = sorted({c for r in runs for c in r.confusion})
    rows = []
    for check in checks:
        base = check_metrics(next(r.confusion[check] for r in runs if check in r.confusion))
        row = [check, _p(base["base_rate"])]
        for r in runs:
            m = check_metrics(r.confusion.get(check, {}))
            row.append(f"{_p(m['precision'])} / {_p(m['recall'])} / {_p(m['flag_recall'])}"
                       f" / {_p(m['review_rate'])}")
        rows.append(row)
    lines += _md_table(["check", "base rate", *[r.name for r in runs]], rows)

    lines += ["", "## Engines: overall decision, cost and latency", ""]
    rows = []
    for r in runs:
        rep = r.report
        rows.append([
            r.name, _p(rep.reject_precision), _p(rep.reject_recall), _p(rep.flag_recall),
            _p(rep.review_rate), _p(rep.false_reject_rate),
            "n/a" if r.cost_per_hour is None else f"{r.cost_per_hour:.2f}",
            "n/a" if r.latency_pct(0.5) is None else f"{r.latency_pct(0.5):.1f}",
            "n/a" if r.latency_pct(0.95) is None else f"{r.latency_pct(0.95):.1f}",
            str(r.failures),
        ])
    lines += _md_table(
        ["engine", "reject precision", "reject recall", "flag recall", "review rate",
         "false reject rate", "USD / video hour", "latency p50 s", "latency p95 s",
         "failed clips"], rows)
    lines += ["", f"Base reject rate of this set: {runs[0].report.base_reject_rate:.2f} "
              f"({runs[0].report.n} clips). Cost of the worker is compute only (not billed here)."]
    for r in runs:
        if r.errors:
            lines += ["", f"First failures of **{r.name}**:"] + [f"- `{e}`" for e in r.errors]

    lines += ["", "## Per-check confusion (expected vs. status)"]
    for r in runs:
        lines += ["", f"### Engine: {r.name}"]
        rows = []
        for check, cells in sorted(r.confusion.items()):
            def n(e: str, g: str, cells: dict = cells) -> int:
                return cells.get((e, g), 0)

            rows.append([
                check,
                str(n("fail", "fail")), str(n("fail", "pass")), str(n("fail", "uncertain")),
                str(n("pass", "fail")), str(n("pass", "pass")), str(n("pass", "uncertain")),
                str(r.excluded.get(check, 0)),
            ])
        lines += _md_table(
            ["check", "defect caught", "defect missed", "defect uncertain",
             "false alarm", "correct pass", "pass uncertain", "excluded (unknown)"], rows)
    lines += ["", "*defect = expected fail; false alarm = expected pass but flagged fail; "
              "uncertain = status was uncertain, error or skipped.*"]

    lines += ["", "## Decisions by variant"]
    for r in runs:
        by_variant: dict[str, Counter[str]] = {}
        for c in clips:
            variant = c.clip_id.split("__", 1)[1] if "__" in c.clip_id else "original"
            by_variant.setdefault(variant, Counter())[r.decisions.get(c.clip_id, "n/a")] += 1
        rows = [[v, *(str(cnt.get(d, 0)) for d in ("accept", "review", "reject", "failed"))]
                for v, cnt in sorted(by_variant.items())]
        lines += ["", f"### Engine: {r.name}"]
        lines += _md_table(["variant", "accept", "review", "reject", "failed"], rows)

    lines += ["", "## Plain-text summary", "", "```", format_runs(runs), "```"]
    return "\n".join(lines) + "\n"


def subset_for(manifest: Sequence[ClipRecord], n_sources: int) -> list[ClipRecord]:
    """The first `n_sources` originals and all of their variants (a fixed, reproducible subset)."""
    keep = [c.clip_id for c in manifest if "__" not in c.clip_id][:n_sources]
    prefixes = tuple(f"{k}__" for k in keep)
    return [c for c in manifest if c.clip_id in keep or c.clip_id.startswith(prefixes)]


def _recording(engine: Engine, store: dict[str, EngineResult]) -> Engine:
    def run(clip: ClipRecord, rubric: Mapping[str, Any]) -> EngineResult:
        t0 = time.monotonic()
        res = engine(clip, rubric)
        store[clip.clip_id] = dataclasses.replace(res, latency_s=time.monotonic() - t0)
        return res

    return run


def _replay(store: dict[str, EngineResult]) -> Engine:
    def run(clip: ClipRecord, rubric: Mapping[str, Any]) -> EngineResult:
        return store.get(clip.clip_id) or EngineResult(None, error="not run")

    return run


def run_ci(
    out_dir: Path,
    clips: int,
    source_builder: SourceBuilder,
    engines: Mapping[str, Engine],
    rubric_path: Path = DEFAULT_RUBRIC,
    keep_media: bool = False,
    notes: Sequence[str | Callable[[], str]] = (),
    subset_sources: Mapping[str, int] | None = None,
) -> str:
    """Run every engine; engines named in `subset_sources` only see that many originals (and
    their variants). The worker's results on that same subset are replayed from its full run,
    so the comparison is like for like and nothing is run (or fingerprinted) twice."""
    out_dir.mkdir(parents=True, exist_ok=True)
    work = out_dir / "work"
    sources_manifest = out_dir / "sources.jsonl"
    source_builder(sources_manifest, work / "sources", clips)
    manifest = build_eval_manifest(load_manifest(sources_manifest), work / "variants")
    write_manifest(manifest, out_dir / "manifest.jsonl")
    rubric = json.loads(rubric_path.read_text())
    subset_sources = subset_sources or {}
    runs: list[EngineRun] = []
    worker_results: dict[str, EngineResult] = {}
    for name, engine in engines.items():
        if name not in subset_sources:
            eng = _recording(engine, worker_results) if name == "worker" else engine
            runs.append(evaluate_engine(name, eng, manifest, rubric))
            continue
        subset = subset_for(manifest, subset_sources[name])
        if "worker" in engines and worker_results and len(subset) < len(manifest):
            runs[0] = dataclasses.replace(runs[0], name=f"worker (all {len(manifest)})")
            runs.append(evaluate_engine(
                f"worker (same {len(subset)})", _replay(worker_results), subset, rubric))
        runs.append(evaluate_engine(f"{name} ({len(subset)} clips)", engine, subset, rubric))
    report = render_report(runs, manifest, notes, requested=clips)
    if worker_results:
        report += privacy_breakdown(worker_results, manifest)
        frames = out_dir / "privacy_frames"
        if frames.is_dir():
            n = contact_sheet(frames, out_dir / "privacy_contact_sheet.jpg")
            report += (f"\nContact sheet: {n} flagged original frames "
                       "(`privacy_contact_sheet.jpg`).\n")
    (out_dir / "report.md").write_text(report)
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a") as f:
            f.write(report)
    if not keep_media:
        shutil.rmtree(work, ignore_errors=True)
    return report


def _hf_source(out: Path, data_dir: Path, n: int) -> int:  # pragma: no cover - network
    return egocentric10k.build(out, data_dir, clips=n, min_factories=MIN_FACTORIES)


def _gemini_client(model: str) -> VideoModelClient:  # pragma: no cover - network
    from .baselines.gemini import GeminiClient

    return GeminiClient(model)


def build_engines(
    env: Mapping[str, str],
    worker_cmd: Sequence[str] | None = None,
    gemini_factory: Callable[[str], VideoModelClient] = _gemini_client,
    gemini_budget_s: float = GEMINI_BUDGET_S,
    gemini_interval_s: float = GEMINI_INTERVAL_S,
    gemini_retries: int = 5,
    sleep: Callable[[float], None] = time.sleep,
) -> tuple[dict[str, Engine], list[str | Callable[[], str]]]:
    """The worker always; Gemini only when its key is set. Returns (engines, report notes).

    Gemini tries the cheapest model first and falls back to the next cheapest the key can use.
    Some notes are callables, resolved when the report is rendered (after the run).
    """
    engines: dict[str, Engine] = {"worker": worker_engine(worker_cmd)}
    notes: list[str | Callable[[], str]] = []
    if not env.get("GEMINI_API_KEY"):
        notes.append("Gemini was SKIPPED: the GEMINI_API_KEY secret is not set.")
        return engines, notes
    models = [env["GEMINI_MODEL"]] if env.get("GEMINI_MODEL") else gemini_models_by_price()
    deadline = time.monotonic() + gemini_budget_s

    def wrap(inner: VideoModelClient) -> RetryingClient:
        return RetryingClient(
            inner, min_interval_s=gemini_interval_s, max_retries=gemini_retries,
            deadline_s=max(0.0, deadline - time.monotonic()), sleep=sleep,
        )

    client = FallbackClient(models, gemini_factory, wrap)
    engines["gemini"] = baseline_engine(client)
    notes.append(
        f"Gemini (free tier, public Build AI clips only, no customer data), cheapest model "
        f"first: {', '.join(f'`{m}`' for m in models)}. Calls are paced at "
        f"{gemini_interval_s:.0f}s, 429s are retried, and the Gemini phase stops after "
        f"{gemini_budget_s / 60:.0f} minutes (remaining clips count as failed). Gemini sees "
        f"only {GEMINI_SUBSET_SOURCES} originals and their variants; the worker is shown on "
        "the same subset and on everything."
    )
    notes.append(client.describe)
    return engines, notes


def main(argv: Sequence[str] | None = None, env: Mapping[str, str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--clips", type=int, default=DEFAULT_CLIPS)
    ap.add_argument("--out-dir", type=Path, default=Path("out"))
    ap.add_argument("--rubric", type=Path, default=DEFAULT_RUBRIC)
    ap.add_argument("--worker-cmd", nargs="+")
    a = ap.parse_args(argv)
    env = os.environ if env is None else env
    out_dir = a.out_dir.resolve()
    # One fingerprint store per run, shared by every worker call, so duplicates find originals.
    os.environ.setdefault("QUELLIX_FINGERPRINT_DB", str(out_dir / "fingerprints.json"))
    # The worker saves an annotated frame for every privacy detection here (contact sheet).
    os.environ.setdefault("QUELLIX_DEBUG_FRAMES_DIR", str(out_dir / "privacy_frames"))
    out_dir.mkdir(parents=True, exist_ok=True)
    engines, notes = build_engines(env, a.worker_cmd)
    report = run_ci(out_dir, a.clips, _hf_source, engines, a.rubric, notes=notes,
                    subset_sources={"gemini": GEMINI_SUBSET_SOURCES})
    print(report)
    return 0


if __name__ == "__main__":  # pragma: no cover
    sys.exit(main())
