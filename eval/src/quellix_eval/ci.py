"""First real evaluation, built to run on GitHub Actions.

    python -m quellix_eval.ci --clips 20 --out-dir eval/out

Pipeline: stream N short clips of Egocentric-10K -> manifest -> synthetic defects (3 variants
per clip, round-robin) -> worker engine -> `report.md` (also appended to $GITHUB_STEP_SUMMARY).

Source clips are ASSUMED acceptable: nobody reviewed them, so any rejection of an original is
a mix of worker error and genuinely bad source footage. Hands and task are not evaluated.
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import sys
from collections import Counter
from collections.abc import Callable, Mapping, Sequence
from pathlib import Path

from .datasets import egocentric10k
from .datasets.manifest import ClipRecord, load_manifest, write_manifest
from .defects.build import build_variants
from .run import Engine, EngineRun, evaluate_engine, format_runs, worker_engine

DEFAULT_RUBRIC = Path(__file__).resolve().parents[2] / "rubrics" / "eval_v0.json"
CI_VARIANTS = (
    "blur", "underexposed", "overexposed", "document", "face", "screen",
    "dup_reencode", "dup_crop", "dup_mirror", "dup_speed", "dup_trim",
)
VARIANTS_PER_CLIP = 3

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


def render_report(runs: Sequence[EngineRun], clips: Sequence[ClipRecord]) -> str:
    n_src = sum(1 for c in clips if "__" not in c.clip_id)
    lines = [
        "# Quellix eval: first real run",
        "",
        "## Read this first",
        f"- **{n_src} source clips** from Build AI Egocentric-10K (Apache 2.0), transcoded to "
        "short low-res clips. They are **assumed acceptable**: nobody reviewed them. A reject "
        "on an original may be the worker's mistake or genuinely bad footage (faces, screens "
        "or documents really in view).",
        f"- **{len(clips) - n_src} synthetic defect clips**, labelled by construction "
        "(blur, exposure, overlays, duplicates).",
        "- **Hands and task completion are not evaluated** (no real labels yet).",
        "- Labels that are not known are excluded per check (see counts below).",
        "- The base reject rate is set by how many defects we generated, not by real traffic: "
        "precision and recall here show detection ability, not production performance.",
        "",
        "## Per-check confusion (expected vs. worker status)",
    ]
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

    lines += ["", "## Overall decision metrics", "", "```", format_runs(runs), "```"]

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
    return "\n".join(lines) + "\n"


def run_ci(
    out_dir: Path,
    clips: int,
    source_builder: SourceBuilder,
    engine: Engine,
    rubric_path: Path = DEFAULT_RUBRIC,
    keep_media: bool = False,
) -> str:
    out_dir.mkdir(parents=True, exist_ok=True)
    work = out_dir / "work"
    sources_manifest = out_dir / "sources.jsonl"
    source_builder(sources_manifest, work / "sources", clips)
    manifest = build_eval_manifest(load_manifest(sources_manifest), work / "variants")
    write_manifest(manifest, out_dir / "manifest.jsonl")
    rubric = json.loads(rubric_path.read_text())
    run = evaluate_engine("worker", engine, manifest, rubric)
    report = render_report([run], manifest)
    (out_dir / "report.md").write_text(report)
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a") as f:
            f.write(report)
    if not keep_media:
        shutil.rmtree(work, ignore_errors=True)
    return report


def _hf_source(out: Path, data_dir: Path, n: int) -> int:  # pragma: no cover - network
    return egocentric10k.build(out, data_dir, clips=n)


def main(argv: Sequence[str] | None = None, env: Mapping[str, str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--clips", type=int, default=20)
    ap.add_argument("--out-dir", type=Path, default=Path("out"))
    ap.add_argument("--rubric", type=Path, default=DEFAULT_RUBRIC)
    ap.add_argument("--worker-cmd", nargs="+")
    a = ap.parse_args(argv)
    out_dir = a.out_dir.resolve()
    # One fingerprint store per run, shared by every worker call, so duplicates find originals.
    os.environ.setdefault("QUELLIX_FINGERPRINT_DB", str(out_dir / "fingerprints.json"))
    out_dir.mkdir(parents=True, exist_ok=True)
    report = run_ci(out_dir, a.clips, _hf_source, worker_engine(a.worker_cmd), a.rubric)
    print(report)
    return 0


if __name__ == "__main__":  # pragma: no cover
    sys.exit(main())
