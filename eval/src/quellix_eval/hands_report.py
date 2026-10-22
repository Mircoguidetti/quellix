"""The hands section of the eval report (#53): how the `hands_visible` check does on synthetic
hand defects, next to the (assumed clean) originals.

Labels by construction: a hand defect changes the middle of the clip (`HAND_INTERVAL`) so that
one hand leaves the frame, both hands leave it, or the hands are cut by the frame edge (expected
`fail`); a static clip has no manipulation (expected `uncertain`, i.e. review). Originals are
assumed to show both hands while working (expected `pass`, not reviewed).
"""

from __future__ import annotations

import statistics
from collections import Counter
from collections.abc import Sequence

from .datasets.manifest import ClipRecord
from .defects.generate import HAND_INTERVAL
from .run import EngineRun

CHECK = "hands_visible"
KINDS = ("original", "hand_out_one", "hands_out_both", "hand_truncated", "no_manipulation")
RATIO = "ratio_both_manipulation"


def _kind(clip_id: str) -> str:
    return clip_id.split("__", 1)[1] if "__" in clip_id else "original"


def _p(x: float | None) -> str:
    return "n/a" if x is None else f"{x:.2f}"


def _status(run: EngineRun, clip_id: str) -> str | None:
    """pass / fail / uncertain (uncertain, error, skipped), or None if the clip did not run."""
    if run.decisions.get(clip_id) in (None, "failed"):
        return None
    status = run.checks_by_clip.get(clip_id, {}).get(CHECK, {}).get("status", "missing")
    return status if status in ("pass", "fail") else "uncertain"


def hands_metrics(run: EngineRun, clips: Sequence[ClipRecord]) -> dict[str, float | int | None]:
    """Rejection precision / recall for the hands check, against its base rate.

    defect = expected fail; caught = status fail. Expected-pass clips that fail are false alarms.
    `uncertain_rate` counts every hands-labelled clip that ended uncertain (no manipulation seen,
    error, skipped), including the static clips whose right answer IS uncertain.
    """
    cells: Counter[tuple[str, str]] = Counter()
    for c in clips:
        expected = c.checks.get(CHECK)
        got = _status(run, c.clip_id)
        if expected in ("pass", "fail", "uncertain") and got is not None:
            cells[(expected, got)] += 1
    defects = sum(n for (e, _), n in cells.items() if e == "fail")
    caught = cells[("fail", "fail")]
    alarms = cells[("pass", "fail")]
    total = sum(cells.values())
    labelled = defects + sum(n for (e, _), n in cells.items() if e == "pass")

    def ratio(a: int, b: int) -> float | None:
        return a / b if b else None

    return {
        "clips": total,
        "base_rate": ratio(defects, labelled),
        "precision": ratio(caught, caught + alarms),
        "recall": ratio(caught, defects),
        "flag_recall": ratio(caught + cells[("fail", "uncertain")], defects),
        "false_alarm_rate": ratio(alarms, labelled - defects),
        "uncertain_rate": ratio(sum(n for (_, g), n in cells.items() if g == "uncertain"), total),
        "static_to_review": ratio(cells[("uncertain", "uncertain")],
                                  sum(n for (e, _), n in cells.items() if e == "uncertain")),
    }


def _median_ratio(run: EngineRun, ids: Sequence[str]) -> str:
    vals = []
    for cid in ids:
        v = run.checks_by_clip.get(cid, {}).get(CHECK, {}).get("measurements", {}).get(RATIO)
        if isinstance(v, int | float):
            vals.append(float(v))
    return f"{statistics.median(vals):.2f} (n={len(vals)})" if vals else "n/a"


def hands_section(runs: Sequence[EngineRun], clips: Sequence[ClipRecord]) -> str:
    a, b = HAND_INTERVAL
    lines = [
        "", "## Hands visibility (#53)", "",
        "Rubric: `hands_visible` on, critical, `scope: manipulation`, `require_both`, "
        "`min_ratio` 0.8. Labels by construction: hand defects change the clip from "
        f"{a:.0%} to {b:.0%} of its length (one hand out, both hands out, hands cut by the "
        "bottom edge) and are expected to **fail**; the static `no_manipulation` clip is "
        "expected to end **uncertain** (review). Originals are **assumed** to pass (not "
        "reviewed), so some false alarms on originals may be real.", "",
    ]
    rows = []
    for r in runs:
        m = hands_metrics(r, clips)
        rows.append([r.name, str(m["clips"]), _p(m["base_rate"]), _p(m["precision"]),
                     _p(m["recall"]), _p(m["flag_recall"]), _p(m["false_alarm_rate"]),
                     _p(m["uncertain_rate"]), _p(m["static_to_review"])])
    lines += _table(["engine", "clips", "base rate", "reject precision", "reject recall",
                     "flag recall", "false alarm rate", "ended uncertain", "static -> review"],
                    rows)
    lines += ["", "*Base rate, precision, recall and false alarms use the pass/fail-labelled "
              "clips; \"ended uncertain\" is over every hands-labelled clip (the share that "
              "went to review because hand visibility could not be measured).*"]

    by_kind: dict[str, list[str]] = {k: [] for k in KINDS}
    for c in clips:
        if c.checks.get(CHECK) in ("pass", "fail", "uncertain") and _kind(c.clip_id) in by_kind:
            by_kind[_kind(c.clip_id)].append(c.clip_id)
    for r in runs:
        rows = []
        for kind, ids in by_kind.items():
            got = Counter(s for cid in ids if (s := _status(r, cid)) is not None)
            if not got:
                continue
            rows.append([kind, str(sum(got.values())), str(got["pass"]), str(got["fail"]),
                         str(got["uncertain"]), _median_ratio(r, ids)])
        if rows:
            lines += ["", f"### By hand defect: {r.name}", ""]
            lines += _table(["clips", "ran", "pass", "fail", "uncertain",
                             f"median {RATIO}"], rows)
    lines += ["", "*With `scope: manipulation`, frames where no hand is in view cannot be "
              "detected as manipulation, so `hands_out_both` can pass on the frames that are "
              "left: a known limit of the scope, measured here rather than hidden.*"]
    return "\n".join(lines) + "\n"


def _table(header: Sequence[str], rows: Sequence[Sequence[str]]) -> list[str]:
    out = ["| " + " | ".join(header) + " |", "|" + "---|" * len(header)]
    return out + ["| " + " | ".join(row) + " |" for row in rows]
