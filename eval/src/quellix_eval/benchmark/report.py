"""Render `eval/reports/benchmark-v2.md` from the slices' results.json files.

    python -m quellix_eval.benchmark.report out/*/results.json --out eval/reports/benchmark-v2.md
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from collections.abc import Mapping, Sequence
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from .kit import blind_slice, load_labels
from .stats import Metrics, Rate, check_pairs, decision_pair, metrics

INDEPENDENT = ("tasks", "hands", "egocentric_blind")
SLICE_TITLE = {
    "tasks": "HoloAssist: task completion",
    "hands": "HoloAssist: hand visibility",
    "egocentric_blind": "Egocentric-10K: blind human labels",
    "synthetic": "Synthetic defects (separate slice)",
}
SLICE_CHECKS = {"tasks": ["task_completed"], "hands": ["hands_visible"],
                "egocentric_blind": ["hands_visible", "technical", "privacy", "framing"],
                "synthetic": ["technical", "privacy", "originality", "hands_visible"]}
ENGINE_TITLE = {"worker": "Ormes"}


def engine_title(e: str) -> str:
    return ENGINE_TITLE.get(e, e.replace("gemini:", "Gemini "))


def ran(res: Mapping[str, Any]) -> bool:
    return not res.get("not_run")


def decision_metrics(clips: Sequence[Mapping[str, Any]], res: Mapping[str, Mapping[str, Any]],
                     only: set[str] | None = None) -> Metrics:
    pairs = []
    for c in clips:
        r = res.get(c["clip_id"])
        if r is None or not ran(r) or (only is not None and c["clip_id"] not in only):
            continue
        pairs.append(decision_pair(c["truth"], r.get("decision")))
    return metrics(pairs)


def check_metrics(clips: Sequence[Mapping[str, Any]], res: Mapping[str, Mapping[str, Any]],
                  check: str, only: set[str] | None = None) -> Metrics:
    pairs = []
    for c in clips:
        r = res.get(c["clip_id"])
        if r is None or not ran(r) or (only is not None and c["clip_id"] not in only):
            continue
        p = check_pairs(c.get("checks", {}).get(check, "unknown"), r.get("checks", {}).get(check))
        if p:
            pairs.append(p)
    return metrics(pairs)


HEAD = ["engine", "clips", "base reject rate", "false reject rate", "false accept rate",
        "reject precision", "reject recall", "review rate"]


def _row(name: str, m: Metrics) -> list[str]:
    return [name, str(m.n), _v(m.base_reject_rate), m.false_reject_rate.fmt(),
            m.false_accept_rate.fmt(), m.reject_precision.fmt(), m.reject_recall.fmt(),
            m.review_rate.fmt()]


def _v(r: Rate) -> str:
    return "n/a" if r.value is None else f"{r.value:.2f}"


def _table(rows: Sequence[Sequence[str]], head: Sequence[str] = HEAD) -> list[str]:
    return (["| " + " | ".join(head) + " |", "|" + "---|" * len(head)]
            + ["| " + " | ".join(r) + " |" for r in rows])


def engine_rows(slices: Sequence[Mapping[str, Any]], fn: Any) -> list[list[str]]:
    """One row per engine; a model that ran on only part of the clips also gets an Ormes row
    on exactly those clips, so the comparison is always like for like."""
    engines: list[str] = []
    for s in slices:
        engines += [e for e in s["engines"] if e not in engines]
    engines.sort(key=lambda e: (e != "worker", e))
    rows = []
    total = sum(len(s["clips"]) for s in slices)
    for e in engines:
        clips = [c for s in slices for c in s["clips"]]
        res = {k: v for s in slices for k, v in s["engines"].get(e, {}).items()}
        rows.append(_row(engine_title(e), fn(clips, res, None)))
        done = {k for k, v in res.items() if ran(v)}
        if e != "worker" and 0 < len(done) < total:
            w = {k: v for s in slices for k, v in s["engines"].get("worker", {}).items()}
            rows.append(_row(f"Ormes, same clips as {engine_title(e)}", fn(clips, w, done)))
    return rows


def render(slices: Sequence[Mapping[str, Any]], meta: Mapping[str, str] | None = None) -> str:
    meta = meta or {}
    by = {s["slice"]: s for s in slices}
    indep = [by[n] for n in INDEPENDENT if n in by]
    n_indep = sum(len(s["clips"]) for s in indep)
    n_all = sum(len(s["clips"]) for s in slices)
    spend = sum(s["spend"]["spent_usd"] for s in slices)
    cap = sum(s["spend"]["cap_usd"] for s in slices)
    by_model: dict[str, float] = {}
    for s in slices:
        for k, v in s["spend"]["by_model"].items():
            by_model[k] = by_model.get(k, 0.0) + v
    lines = [
        "# Ormes benchmark v2",
        "",
        f"{meta.get('date', datetime.now(UTC).strftime('%Y-%m-%d'))} · commit "
        f"`{meta.get('commit', 'local')}` · run {meta.get('run', 'local')} · "
        f"**{n_all} clips** ({n_indep} with independent labels) · Gemini spend "
        f"**${spend:.2f}** of a ${cap:.2f} cap"
        + (" (" + ", ".join(f"{k}: ${v:.2f}" for k, v in sorted(by_model.items())) + ")"
           if by_model else "") + ".",
        "",
        "**How to read this.** Every rate has a 95% confidence interval (Wilson) and its count. "
        "A *false reject* is a good video rejected (it costs an honest contributor money); a "
        "*false accept* is a bad video accepted (it costs the collector a lab rejection). Both "
        "are always shown, next to the base reject rate. *Review* = sent to a person; it is "
        "neither a false reject nor a false accept, and its cost is the review rate.",
        "",
        "## Independent labels (headline)",
        "",
    ]
    if indep:
        lines += _table(engine_rows(indep, decision_metrics))
    else:
        lines.append("No slice with independent labels ran.")
    for name in [*INDEPENDENT, "synthetic"]:
        if name not in by:
            continue
        s = by[name]
        lines += ["", f"## {SLICE_TITLE[name]}", ""]
        for check in SLICE_CHECKS.get(name, []):
            def fn(clips: Any, res: Any, only: Any, check: str = check) -> Metrics:
                return check_metrics(clips, res, check, only)

            rows = [r for r in engine_rows([s], fn) if r[1] != "0"]
            if rows:
                lines += [f"Check `{check}`:", "", *_table(rows), ""]
        skipped = s.get("stats", {}).get("skipped") or {}
        if skipped:
            lines.append("Not included: " + "; ".join(f"{v} {k}" for k, v in skipped.items())
                         + ".")
    lines += ["", "## Method, label provenance, limits", "", METHOD]
    if "egocentric_blind" not in by:
        lines.append("- **Egocentric-10K blind labels: pending.** The labelling kit is ready "
                     "(see `eval/CLAUDE.md`); that slice is added once an independent "
                     "labeller has labelled it.")
    return "\n".join(lines) + "\n"


METHOD = """\
- **Task completion (HoloAssist, CDLA-Permissive-2.0, official validation split).** For each
  session, one 60 s clip ending just after the last annotated fine-grained action (completed)
  and one ending halfway through it (not completed). Labels come from HoloAssist's own action
  annotations; sessions with an uncorrected wrong action get no "completed" clip. Task text and
  steps are HoloAssist's coarse-action sentences.
- **Hand visibility (HoloAssist).** Labels come from the headset's own hand tracking: the 26
  joints of each hand are projected into the RGB frame with the released camera pose and
  intrinsics (as in the authors' PyHoloAssist). A hand is visible if every joint is inside
  the frame; "manipulation" = inside an annotated action. Windows of 20 s are drawn at random,
  not by label. Label pass if both hands are visible >= 85% of manipulation frames, fail if
  <= 75%; windows in between are left out as ambiguous.
- **Synthetic defects** are generated from Egocentric-10K clips assumed acceptable (not
  reviewed). They measure detection of known defects only and are never pooled with the
  independent slices.
- **Engines.** Ormes = the worker as deployed, scored with the slice's rubric (only the checks
  that have labels are on). Gemini gets the full rubric, the task and the measurement
  definitions, answers in a JSON schema with a per-check confidence (exact prompts:
  `eval/prompts/benchmark_v2/`); measurements below 0.5 confidence count as "could not tell".
  Both are turned into decisions by the same rubric code. The strong model runs on a
  label-balanced order until the spend cap stops it, and Ormes is shown on the same clips.
- **Limits.** HoloAssist is lab footage (assembly, appliances), not a collector's production
  traffic; base rates here are set by the construction of the slices, not by real traffic.
  Not-completed clips are cut inside the last action, a narrow kind of incompleteness. Hand
  pose has tracking noise (hence the 75-85% exclusion band). Gemini sees low-resolution frames
  to stay inside the budget."""


def main(argv: Sequence[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("results", nargs="+", type=Path)
    ap.add_argument("--out", type=Path, required=True)
    a = ap.parse_args(argv)
    slices = [json.loads(p.read_text()) for p in a.results if p.exists()]
    labels = load_labels()
    for s in list(slices):
        if s["slice"] == "synthetic" and labels and (blind := blind_slice(s, labels)):
            slices.append(blind)
    if not slices:
        print("no results.json found", file=sys.stderr)
        return 1
    meta = {"commit": os.environ.get("GITHUB_SHA", "local")[:7],
            "run": os.environ.get("GITHUB_RUN_ID", "local")}
    a.out.parent.mkdir(parents=True, exist_ok=True)
    a.out.write_text(render(slices, meta))
    print(a.out.read_text())
    return 0


if __name__ == "__main__":  # pragma: no cover
    sys.exit(main())
