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
import json
import os
import re
import shutil
import sys
import time
from collections import Counter
from collections.abc import Callable, Mapping, Sequence
from pathlib import Path

from .baselines.common import VideoModelClient
from .baselines.retry import RetryingClient
from .datasets import egocentric10k
from .datasets.manifest import ClipRecord, load_manifest, write_manifest
from .defects.build import build_variants
from .prices import cheapest_gemini_flash_lite
from .run import (
    Engine,
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


def render_report(
    runs: Sequence[EngineRun], clips: Sequence[ClipRecord], notes: Sequence[str] = ()
) -> str:
    n_src = sum(1 for c in clips if "__" not in c.clip_id)
    factories = _factories(clips)
    lines = [
        "# Quellix eval: worker vs. general model",
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
    lines += [f"- **{n}**" for n in notes]

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


def run_ci(
    out_dir: Path,
    clips: int,
    source_builder: SourceBuilder,
    engines: Mapping[str, Engine],
    rubric_path: Path = DEFAULT_RUBRIC,
    keep_media: bool = False,
    notes: Sequence[str] = (),
) -> str:
    out_dir.mkdir(parents=True, exist_ok=True)
    work = out_dir / "work"
    sources_manifest = out_dir / "sources.jsonl"
    source_builder(sources_manifest, work / "sources", clips)
    manifest = build_eval_manifest(load_manifest(sources_manifest), work / "variants")
    write_manifest(manifest, out_dir / "manifest.jsonl")
    rubric = json.loads(rubric_path.read_text())
    runs = [evaluate_engine(name, engine, manifest, rubric) for name, engine in engines.items()]
    report = render_report(runs, manifest, notes)
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
) -> tuple[dict[str, Engine], list[str]]:
    """The worker always; Gemini only when its key is set. Returns (engines, report notes)."""
    engines: dict[str, Engine] = {"worker": worker_engine(worker_cmd)}
    notes: list[str] = []
    if not env.get("GEMINI_API_KEY"):
        notes.append("Gemini was SKIPPED: the GEMINI_API_KEY secret is not set.")
        return engines, notes
    model = env.get("GEMINI_MODEL") or cheapest_gemini_flash_lite()
    try:
        client = RetryingClient(
            gemini_factory(model), min_interval_s=gemini_interval_s,
            max_retries=gemini_retries, deadline_s=gemini_budget_s, sleep=sleep,
        )
    except Exception as e:  # noqa: BLE001 - a broken Gemini setup must not sink the worker run
        notes.append(f"Gemini was SKIPPED: could not start the client ({e}).")
        return engines, notes
    engines["gemini"] = baseline_engine(client)
    notes.append(
        f"Gemini model: `{model}` (free tier, public Build AI clips only, no customer data). "
        f"Calls are paced at {gemini_interval_s:.0f}s, 429s are retried, and the Gemini phase "
        f"stops after {gemini_budget_s / 60:.0f} minutes (remaining clips count as failed)."
    )
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
    out_dir.mkdir(parents=True, exist_ok=True)
    engines, notes = build_engines(env, a.worker_cmd)
    report = run_ci(out_dir, a.clips, _hf_source, engines, a.rubric, notes=notes)
    print(report)
    return 0


if __name__ == "__main__":  # pragma: no cover
    sys.exit(main())
