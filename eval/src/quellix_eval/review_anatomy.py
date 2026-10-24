"""Why clips go to review: decision anatomy of a benchmark v2 run, per slice.

    python -m quellix_eval.review_anatomy --run 39783934037=out/anatomy/run-39783934037 \\
        --check-run 39798084516=out/anatomy/run-39798084516 \\
        --published reports/benchmark-v2.md --out reports/review-anatomy.md

A run directory holds `benchmark-<slice>/results.json` (the artifacts of `benchmark.yml`).
results.json has, per clip, the decision and each check's status, but no reason codes and no
measurements. Reason codes are therefore *inferred* from the rubric embedded in each results.json
(never from the rubric files at HEAD) and from the statuses, with the rules in `review_causes`.
The decision rule applied is the one of the build that ran (see `BuildRules`).

Nothing here reruns the worker or calls an API: it reads JSON and writes Markdown.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from collections import Counter
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from .benchmark.report import ran, render
from .benchmark.stats import Rate, decision_pair

SLICES = ("tasks", "hands", "synthetic")
INDEPENDENT = ("tasks", "hands")
MIN_N = 30   # below this denominator a rate is not compared with a target

# Reference targets: a gap measure, not a test. Fixed before the data was read; never tuned.
TARGET_DECIDED = 0.70   # share of clips decided without a person (accept + reject), at least
TARGET_FAR = 0.02       # false accept rate (bad clips accepted / bad clips), at most
TARGET_FRR = 0.05       # false reject rate (good clips rejected / good clips), at most

HANDS_AMBIGUOUS = "hands_visible.error or hands_visible.missing_measurement"


@dataclass(frozen=True)
class BuildRules:
    """How the build that produced results.json turned a failed check into an effect.

    `hands_can_reject`: run 39783934037 ran merge commit 0ed53ff (PR head 028f18e on base 3c282ed),
    which predates #76 (`HANDS_CAN_REJECT = False`) and #81 (`HANDS_UNCERTAIN_BAND`): a failed
    critical hands check rejected, and the hands check had no `uncertain` status.
    """

    hands_can_reject: bool = True


RUN_BUILD = BuildRules(hands_can_reject=True)


# --- loading -------------------------------------------------------------------------------


def load_run(directory: Path) -> dict[str, dict[str, Any]]:
    """{slice name: results.json} for the slices present in a run directory."""
    out: dict[str, dict[str, Any]] = {}
    for name in SLICES:
        p = directory / f"benchmark-{name}" / "results.json"
        if p.is_file():
            data = json.loads(p.read_text())
            out[data["slice"]] = data
    return out


def enabled_checks(rubric: Mapping[str, Any]) -> list[str]:
    return [k for k, v in rubric.get("checks", {}).items() if v.get("enabled", True)]


# --- reason inference ----------------------------------------------------------------------


def fail_effect(rubric: Mapping[str, Any], check: str, rules: BuildRules = RUN_BUILD) -> str:
    """Effect of a `fail` status for `check` under the embedded rubric and the build's rules."""
    cfg = rubric.get("checks", {}).get(check, {})
    if check == "privacy":
        acts = {cfg.get(k, "review") for k in ("faces", "documents", "screens")} - {"ignore"}
        return "reject" if acts == {"reject"} else "review"
    if check == "originality":
        return str(cfg.get("on_duplicate", "reject"))
    if check == "hands_visible" and not rules.hands_can_reject:
        return "review"
    return "reject" if cfg.get("critical", True) else "review"


def fail_code(rubric: Mapping[str, Any], check: str) -> str:
    """Reason code of a review-effect `fail`; several possible codes are joined with ' or '."""
    cfg = rubric.get("checks", {}).get(check, {})
    if check == "framing":
        return "framing.off_target or framing.unstable"
    if check == "privacy":
        kinds = [k for k in ("faces", "documents", "screens") if cfg.get(k, "review") == "review"]
        return " or ".join(f"privacy.{k}" for k in kinds)
    return {"hands_visible": "hands_visible.below_min",
            "task_completed": "task_completed.not_completed",
            "originality": "originality.duplicate"}.get(check, f"{check}.*")


def review_causes(rubric: Mapping[str, Any], statuses: Mapping[str, str],
                  rules: BuildRules = RUN_BUILD) -> list[str]:
    """Inferred reason codes with effect `review` for one clip, from check statuses only.

    Rules, per enabled check of the embedded rubric:
    - `error`: `<check>.error`; for hands_visible also `missing_measurement` gives `error`, so
      the code is reported as ambiguous (`HANDS_AMBIGUOUS`);
    - `uncertain`: `<check>.uncertain` (task_completed below min_confidence; hands_visible only
      from #81, i.e. never in run 39783934037);
    - `fail`: a cause only when its effect is `review` (`fail_effect`), code from `fail_code`;
    - `skipped` on an enabled check: `pipeline.skipped_without_reject`;
    - missing from `checks`: `<check>.missing_status`.
    Disabled checks are ignored (the worker reports them as `skipped`).
    """
    causes: list[str] = []
    for check in enabled_checks(rubric):
        s = statuses.get(check)
        if s is None:
            causes.append(f"{check}.missing_status")
        elif s == "error":
            causes.append(HANDS_AMBIGUOUS if check == "hands_visible" else f"{check}.error")
        elif s == "uncertain":
            causes.append(f"{check}.uncertain")
        elif s == "fail" and fail_effect(rubric, check, rules) == "review":
            causes.append(fail_code(rubric, check))
        elif s == "skipped":
            causes.append("pipeline.skipped_without_reject")
    return sorted(set(causes))


def expected_decision(rubric: Mapping[str, Any], statuses: Mapping[str, str],
                      rules: BuildRules = RUN_BUILD) -> str:
    """The decision the build's rule gives for these statuses (a consistency check)."""
    for check in enabled_checks(rubric):
        if statuses.get(check) == "fail" and fail_effect(rubric, check, rules) == "reject":
            return "reject"
    return "review" if review_causes(rubric, statuses, rules) else "accept"


# --- per-slice anatomy ---------------------------------------------------------------------


@dataclass
class Anatomy:
    name: str
    clips: int = 0
    not_run: int = 0
    null_decision: int = 0
    # (truth, decision) -> count; decision None counts as review (as `decision_pair` does)
    table: Counter[tuple[str, str]] = field(default_factory=Counter)
    causes: Counter[str] = field(default_factory=Counter)
    sole: Counter[str] = field(default_factory=Counter)
    reviews: list[tuple[str, str, list[str]]] = field(default_factory=list)  # id, truth, causes
    inconsistent: list[str] = field(default_factory=list)

    @property
    def ran(self) -> int:
        return self.clips - self.not_run

    def count(self, truth: str | None = None, decision: str | None = None) -> int:
        return sum(v for (t, d), v in self.table.items()
                   if (truth is None or t == truth) and (decision is None or d == decision))

    @property
    def decided(self) -> Rate:
        return Rate(self.count(decision="accept") + self.count(decision="reject"), self.ran)

    @property
    def far(self) -> Rate:
        return Rate(self.count("reject", "accept"), self.count("reject"))

    @property
    def frr(self) -> Rate:
        return Rate(self.count("accept", "reject"), self.count("accept"))

    @property
    def base_reject(self) -> Rate:
        return Rate(self.count("reject"), self.ran)


def anatomy(data: Mapping[str, Any], engine: str = "worker",
            rules: BuildRules = RUN_BUILD) -> Anatomy:
    a = Anatomy(data["slice"])
    res = data["engines"].get(engine, {})
    rubric = data["rubric"]
    for c in data["clips"]:
        a.clips += 1
        r = res.get(c["clip_id"])
        if r is None or not ran(r):
            a.not_run += 1
            continue
        _, got = decision_pair(c["truth"], r.get("decision"))
        decision = {"pass": "accept", "fail": "reject"}.get(got, "review")
        if r.get("decision") is None:
            a.null_decision += 1
        a.table[(c["truth"], decision)] += 1
        statuses = r.get("checks", {})
        if r.get("decision") is not None and expected_decision(rubric, statuses, rules) != decision:
            a.inconsistent.append(c["clip_id"])
        if decision != "review":
            continue
        causes = (review_causes(rubric, statuses, rules) if r.get("decision") is not None
                  else ["no decision (worker run failed)"])
        a.reviews.append((c["clip_id"], c["truth"], causes))
        a.causes.update(causes)
        if len(causes) == 1:
            a.sole[causes[0]] += 1
    return a


def pooled(parts: Iterable[Anatomy], name: str) -> Anatomy:
    out = Anatomy(name)
    for p in parts:
        out.clips += p.clips
        out.not_run += p.not_run
        out.null_decision += p.null_decision
        out.table.update(p.table)
        out.causes.update(p.causes)
        out.sole.update(p.sole)
        out.reviews += p.reviews
        out.inconsistent += p.inconsistent
    return out


def gap(rate: Rate, target: float, at_least: bool) -> str:
    """Distance to a reference target in percentage points, or 'n too small' when n < MIN_N.

    Positive = the target is not reached by that many points (for an 'at least' target, the
    target minus the value; for an 'at most' target, the value minus the target)."""
    if rate.n < MIN_N or rate.value is None:
        return "n too small"
    d = (target - rate.value) if at_least else (rate.value - target)
    return f"{max(d, 0.0) * 100:.1f}" if d > 0 else "0.0"


# --- Step 3: ceiling against labels --------------------------------------------------------


@dataclass
class Ceiling:
    check: str
    sole_reviews: int = 0
    labelled: int = 0        # sole-cause reviews whose label for that check is pass / fail
    to_accept: int = 0
    to_reject: int = 0
    accept_truth: Counter[str] = field(default_factory=Counter)  # truth of clips -> accept
    reject_truth: Counter[str] = field(default_factory=Counter)


def ceiling(data: Mapping[str, Any], engine: str = "worker",
            rules: BuildRules = RUN_BUILD) -> dict[str, Ceiling]:
    """For each check X: on reviews whose only inferred cause is X, replace X's status with the
    clip's label for X (pass / fail; unknown labels are not counted) and re-apply the decision
    rule. Upper bound on clips that become automatic if X were right on exactly those clips."""
    res = data["engines"].get(engine, {})
    rubric = data["rubric"]
    out: dict[str, Ceiling] = {}
    for c in data["clips"]:
        r = res.get(c["clip_id"])
        if r is None or not ran(r) or r.get("decision") != "review":
            continue
        statuses = dict(r.get("checks", {}))
        causes = review_causes(rubric, statuses, rules)
        if len(causes) != 1:
            continue
        check = causes[0].split(".")[0]
        ce = out.setdefault(check, Ceiling(check))
        ce.sole_reviews += 1
        label = c.get("checks", {}).get(check, "unknown")
        if label not in ("pass", "fail"):
            continue
        ce.labelled += 1
        statuses[check] = label
        new = expected_decision(rubric, statuses, rules)
        if new == "accept":
            ce.to_accept += 1
            ce.accept_truth[c["truth"]] += 1
        elif new == "reject":
            ce.to_reject += 1
            ce.reject_truth[c["truth"]] += 1
    return out


# --- Step 0: reproduction ------------------------------------------------------------------


def parse_tables(md: str) -> dict[tuple[str, str], list[list[str]]]:
    """{(section heading, check or ''): table rows (cells, header excluded)} of a report."""
    out: dict[tuple[str, str], list[list[str]]] = {}
    section, check = "", ""
    for line in md.splitlines():
        if line.startswith("## "):
            section, check = line[3:].strip(), ""
        elif m := re.match(r"Check `(\w+)`:", line):
            check = m.group(1)
        elif line.startswith("| ") and not line.startswith("| engine"):
            cells = [x.strip() for x in line.strip().strip("|").split("|")]
            out.setdefault((section, check), []).append(cells)
    return out


@dataclass
class Repro:
    compared: int = 0
    mismatches: list[str] = field(default_factory=list)


def reproduce(slices: Sequence[Mapping[str, Any]], published: str,
              ormes_only_plain: bool = False) -> Repro:
    """Re-render the run with `report.render` and compare every Ormes row's numeric cells (all
    columns but the row label) with the published report. Rows are matched by position within
    each table; the row labels differ between builds ("Ormes, same 201 clips" then, "Ormes, same
    clips as ..." now), the numbers must not. `ormes_only_plain` compares only the plain Ormes
    row of each table (for a run whose Gemini engines scored nothing)."""
    mine = parse_tables(render(slices))
    theirs = parse_tables(published)
    rep = Repro()
    for key, rows in theirs.items():
        new = mine.get(key, [])
        for i, row in enumerate(rows):
            if not row[0].startswith("Ormes") or (ormes_only_plain and row[0] != "Ormes"):
                continue
            if ormes_only_plain:
                match = next((r for r in new if r[0] == "Ormes"), None)
            else:
                match = new[i] if i < len(new) and new[i][0].startswith("Ormes") else None
            rep.compared += 1
            if match is None or match[1:] != row[1:]:
                rep.mismatches.append(f"{key[0]} / {key[1] or 'decision'} / {row[0]}: "
                                      f"published {row[1:]}, recomputed "
                                      f"{match[1:] if match else 'missing'}")
    return rep


# --- rendering -----------------------------------------------------------------------------


def _t(head: Sequence[str], rows: Iterable[Sequence[Any]]) -> list[str]:
    return (["| " + " | ".join(head) + " |", "|" + "---|" * len(head)]
            + ["| " + " | ".join(str(x) for x in r) + " |" for r in rows])


def _r(rate: Rate) -> str:
    return rate.fmt()


SLICE_LABEL = {
    "tasks": "tasks (HoloAssist, labels from action annotations)",
    "hands": "hands (HoloAssist, labels from hand tracking)",
    "pooled": "pooled tasks + hands (the headline 379)",
    "synthetic": "synthetic (Egocentric-10K; truth = assumed variant label, not human)",
}


def anatomy_tables(parts: Sequence[Anatomy]) -> list[str]:
    head = ["slice", "ran", "not run", "null decision", "good: accept / reject / review",
            "bad: accept / reject / review", "base reject rate"]
    rows = [[SLICE_LABEL.get(a.name, a.name), a.ran, a.not_run, a.null_decision,
             " / ".join(str(a.count("accept", d)) for d in ("accept", "reject", "review")),
             " / ".join(str(a.count("reject", d)) for d in ("accept", "reject", "review")),
             _r(a.base_reject)] for a in parts]
    lines = _t(head, rows) + [""]
    head2 = ["slice", "decided without a person", "gap to >= 70% (points)",
             "false accept rate", "gap to <= 2% (points)", "false reject rate",
             "gap to <= 5% (points)"]
    rows2 = [[SLICE_LABEL.get(a.name, a.name), _r(a.decided), gap(a.decided, TARGET_DECIDED, True),
              _r(a.far), gap(a.far, TARGET_FAR, False), _r(a.frr), gap(a.frr, TARGET_FRR, False)]
             for a in parts]
    return lines + _t(head2, rows2)


def cause_table(a: Anatomy) -> list[str]:
    reviews = len(a.reviews)
    if not reviews:
        return ["No review."]
    rows = [[f"`{code}`", n, a.sole.get(code, 0),
             sum(1 for _, t, cs in a.reviews if code in cs and t == "accept"),
             sum(1 for _, t, cs in a.reviews if code in cs and t == "reject")]
            for code, n in a.causes.most_common()]
    return _t(["inferred reason code", "reviews with it", "only cause",
               "of which truth good", "of which truth bad"], rows) + [
        "", f"{reviews} reviews; {sum(a.sole.values())} have exactly one inferred cause."]


def ceiling_table(ce: Mapping[str, Ceiling]) -> list[str]:
    if not ce:
        return ["No review with a single cause."]
    rows = [[f"`{c.check}`", c.sole_reviews, c.labelled, c.to_accept,
             _counts(c.accept_truth), c.to_reject, _counts(c.reject_truth)]
            for c in sorted(ce.values(), key=lambda c: -c.sole_reviews)]
    return _t(["check X (only cause)", "reviews", "with a pass/fail label for X",
               "-> accept", "truth of those", "-> reject", "truth of those"], rows)


def _counts(c: Counter[str]) -> str:
    names = {"accept": "good", "reject": "bad"}
    return ", ".join(f"{n} {names.get(k, k)}" for k, n in sorted(c.items())) or "-"


def review_list(a: Anatomy) -> list[str]:
    rows = [[f"`{cid}`", "good" if t == "accept" else "bad", ", ".join(f"`{x}`" for x in cs)]
            for cid, t, cs in sorted(a.reviews)]
    return _t(["clip", "truth", "inferred causes"], rows)


@dataclass
class RunInfo:
    run_id: str
    head_sha: str
    event: str
    merge_commit: str | None = None


def render_report(run: Mapping[str, Mapping[str, Any]], info: RunInfo, check_run: Mapping[
        str, Mapping[str, Any]] | None, check_info: RunInfo | None, published: str) -> str:
    parts = {n: anatomy(run[n]) for n in SLICES if n in run}
    pool = pooled([parts[n] for n in INDEPENDENT if n in parts], "pooled")
    repro = reproduce([run[n] for n in SLICES if n in run], published)
    lines = [
        "# Why clips go to review (benchmark v2, decision anatomy)",
        "",
        "An analysis of where Ormes sends clips to a person and what each cause is worth. It is "
        "not a verdict on the product: it lists gaps and a ranked work list. Generated by "
        "`python -m quellix_eval.review_anatomy` from the runs' `results.json` (not committed: "
        "they hold temporary clip paths); every number below can be regenerated from them.",
        "",
        "## Summary",
        "",
        *summary(parts, pool),
        "",
        "## Provenance",
        "",
        *_t(["run", "event", "head_sha (PR head)", "commit the job checked out"], [
            [i.run_id, i.event, f"`{i.head_sha[:7]}`", f"`{i.merge_commit}`" if i.merge_commit
             else "pull-request merge commit, not recorded"]
            for i in [info, *([check_info] if check_info else [])]]),
        "",
        PROVENANCE,
        "",
        "## Step 0: reproduction of the published Ormes rows",
        "",
        f"Run {info.run_id}: re-rendered with `quellix_eval.benchmark.report.render` from its "
        f"three `results.json`; {repro.compared} Ormes rows of `eval/reports/benchmark-v2.md` "
        "(headline, pooled, and every per-check row, including the 'Ormes, same N clips' rows) "
        f"compared cell by cell: **{len(repro.mismatches)} differences**.",
    ]
    lines += [f"- {m}" for m in repro.mismatches]
    if check_run is not None and check_info is not None:
        r2 = reproduce([check_run[n] for n in SLICES if n in check_run], published,
                       ormes_only_plain=True)
        same = all(sorted(_clip_view(check_run[n])) == sorted(_clip_view(run[n]))
                   for n in SLICES if n in run and n in check_run)
        lines += [
            "",
            f"Run {check_info.run_id} (determinism check, a different build whose Gemini engines "
            f"scored nothing): {r2.compared} plain Ormes rows compared with the published report: "
            f"**{len(r2.mismatches)} differences**. Per clip (clip id, truth, labels, decision, "
            f"check statuses) the worker output of the two runs is "
            f"**{'identical' if same else 'NOT identical'}**. The 'Ormes, same N clips' rows "
            "cannot be reproduced from this run alone (they are defined by the clips Gemini "
            "scored in run " + info.run_id + "); that is not a mismatch.",
        ]
        lines += [f"- {m}" for m in r2.mismatches]
    lines += ["", "## Step 1: decision anatomy, per slice", "", STEP1_NOTE, ""]
    lines += anatomy_tables([parts[n] for n in INDEPENDENT if n in parts] + [pool]
                            + ([parts["synthetic"]] if "synthetic" in parts else []))
    incons = sum(len(p.inconsistent) for p in parts.values())
    lines += ["", f"Consistency: re-applying the build's decision rule (critical fail -> reject, "
              f"any review cause -> review, else accept; a failed hands check rejects) to the "
              f"recorded statuses gives the recorded decision on all but {incons} clips."]
    lines += ["", "## Step 2: why each clip went to review", "", INFERENCE_RULES, ""]
    for n in (*INDEPENDENT, "synthetic"):
        if n in parts:
            lines += [f"### {SLICE_LABEL[n]}", "", *cause_table(parts[n]), ""]
    lines += [SOLE_CAUSE_NOTE, "", "### Every synthetic review, clip by clip", ""]
    if "synthetic" in parts:
        lines += review_list(parts["synthetic"])
    hands_reviews = parts["hands"].reviews if "hands" in parts else []
    lines += ["", "Hands slice reviews: " + ", ".join(
        f"`{cid}` ({'good' if t == 'accept' else 'bad'})" for cid, t, _ in sorted(hands_reviews))
        + ".", "", CAUSES_FROM_CODE, ""]
    lines += ["## Step 3: ceiling of automatic decisions", "", STEP3_INTRO, ""]
    for n in (*INDEPENDENT, "synthetic"):
        if n in run:
            lines += [f"### {SLICE_LABEL[n]}", "", *ceiling_table(ceiling(run[n])), ""]
    lines += [STEP3_READING, "", EXPERIMENTS, "", WORK_INTRO, "", *_t(WORK_HEAD, WORK_ROWS), "",
              CANNOT_SHOW, "", OPEN_QUESTIONS]
    return "\n".join(lines) + "\n"


def summary(parts: Mapping[str, Anatomy], pool: Anatomy) -> list[str]:
    reviews = pool.count(decision="review")
    out = [f"- Independently labelled clips (tasks + hands): {pool.ran} ran, "
           f"{pool.count(decision='accept')} accept, {pool.count(decision='reject')} reject, "
           f"{reviews} review; decided without a person {_r(pool.decided)}."]
    for name in INDEPENDENT:
        if name in parts:
            for code, n in parts[name].causes.most_common():
                out.append(f"- {n} of the {reviews} reviews: `{code}` ({name} slice, "
                           f"{n / reviews:.0%} of the reviews).")
    out += [
        "- The task errors come from the benchmark giving the worker no task model "
        "(`QUELLIX_TASKS_HEAD` unset, external models off); whether production has one is an "
        "open question. The hands rejects (11 of 11 good clips) come from a build before #76: "
        "at HEAD a hands failure goes to review, so those 117 automatic rejects would not be "
        "automatic. The two causes are separate and are reported separately below.",
        "- No existing slice measures how many more clips the full rubric would decide if one "
        "check were right; Step 3 specifies the smallest $0 experiment that would.",
    ]
    return out


def _clip_view(data: Mapping[str, Any]) -> list[str]:
    res = data["engines"].get("worker", {})
    return [json.dumps([c["clip_id"], c["truth"], c["checks"], res.get(c["clip_id"], {}).get(
        "decision"), res.get(c["clip_id"], {}).get("checks")], sort_keys=True)
        for c in data["clips"]]


# --- fixed text (facts from code and from the GitHub API, not from results.json) -----------

PROVENANCE = """\
- The benchmark's code landed on `main` as `d487264` (#67). Neither run used that commit.
  Both were `pull_request` runs on branch `agent/benchmark-v2`, so the job checked out GitHub's
  merge of the PR head into the base of the moment. For run 39783934037 that merge commit is
  `0ed53ff` (`gh api repos/Mircoguidetti/quellix/commits/0ed53ff`: "Merge 028f18e into 3c282ed",
  parents `3c282ed` and `028f18e`). `0ed53ff` and `028f18e` are not reachable from any branch of
  this repository (`git cat-file -t` fails); `3c282ed` (#58) is on `main`. For run 39798084516
  the merge commit is not recorded; it ran at 14:42 UTC on 2026-10-22, before #76 landed
  (16:25 UTC), so its base also lacked #76 (inferred from timestamps).
- `gh api repos/Mircoguidetti/quellix/compare/8e68d87...<sha>`: `3c282ed` is *behind* `8e68d87`
  (an ancestor of it), `028f18e` and `ca702ef` have *diverged* from it. So `8e68d87` (#76,
  `HANDS_CAN_REJECT = False`) is in neither build, and `aa4e3c7` (#81, `HANDS_UNCERTAIN_BAND`,
  hands@0.2.0) came a day later. `services/worker/src/quellix_worker/rubric.py` at `0ed53ff`
  defines neither constant: a `hands_visible` failure with `critical: true` rejected.
- Workflow `.github/workflows/benchmark.yml` at `0ed53ff`, slice job: `env` sets only `HF_TOKEN`,
  `GEMINI_API_KEY`, `QUELLIX_HOLO_CACHE` (and `QUELLIX_FINGERPRINT_DB` for synthetic). No
  `QUELLIX_TASKS_HEAD`. The worker runs on the GitHub-hosted `ubuntu-latest` runner (CPU)."""

STEP1_NOTE = """\
"Decided without a person" = (accept + reject) / clips that ran. Clips marked `not_run` are left
out, as `report.py` does; a null decision counts as review, as `stats.decision_pair` does.
Good = truth `accept`, bad = truth `reject`. False accept rate = bad accepted / bad; false reject
rate = good rejected / good (as in `stats.metrics`). Every rate: Wilson 95% interval and count.
Reference targets (a gap measure, not a test, fixed before the data was read): at least 70%
decided without a person, false accept rate at most 2%, false reject rate at most 5%. A gap is
the number of percentage points by which the point estimate is on the wrong side of the target
(0.0 if it is not); it is not computed when the denominator is under 30 ("n too small").
The synthetic slice's truth is the assumed label of each variant (originals assumed acceptable,
not reviewed by a person); its rates are against those assumed labels."""

INFERENCE_RULES = """\
results.json has statuses, not reason codes. Codes are inferred per enabled check of the rubric
embedded in each results.json (the files in `eval/rubrics/` at HEAD are not used; the worker
gained a `viewpoint` check after the run) with the decision rule of the build that ran:

- `error` -> `<check>.error`. For `hands_visible`, `missing_measurement` also gives status `error`
  (rubric.py at `0ed53ff`), so it is reported as "check error, code ambiguous"
  (`hands_visible.error or hands_visible.missing_measurement`).
- `uncertain` -> `<check>.uncertain`. Only `task_completed` could return it at run time; the hands
  uncertain band arrived in #81, after the run, so `uncertain` cannot occur for hands here.
- `fail` -> a review cause only when its effect is review: `framing` with `critical: false`
  (`framing.off_target or framing.unstable`, which of the two is not recorded) and `privacy` with
  faces / documents / screens set to review (`privacy.faces or privacy.documents or
  privacy.screens`, which kind is not recorded). A critical fail (technical, originality,
  hands_visible at this build, task_completed) rejects and is not a review cause.
- `skipped` on an enabled check -> `pipeline.skipped_without_reject` (did not occur).
- The tasks slice enables only `task_completed`, so its status `error` means
  `task_completed.error`; the hands slice enables only `hands_visible`."""

SOLE_CAUSE_NOTE = """\
In the tasks and hands slices one check is enabled, so every review has exactly one cause by
construction; "only cause" carries information only on the synthetic slice, whose truth is the
assumed variant label (see Step 1)."""

CAUSES_FROM_CODE = """\
### Cause of the `task_completed` errors (code and run environment)

- The eval drives the worker CLI as `python -m quellix_worker check P --rubric R --video-id ID
  --report REPORT.json` (`eval/src/quellix_eval/run.py:74` at `0ed53ff`, line 76 at HEAD), without
  `--task-model`.
- `services/worker/src/quellix_worker/__main__.py:40` (at `0ed53ff`): `--task-model` defaults to
  `none`; line 73 sets `allow_external_models=args.task_model != "none"`, i.e. `False`, and no
  `task_judge` is built.
- `QUELLIX_TASKS_HEAD` is not set in the benchmark job (see Provenance), so
  `task_local.configured_model()` returns `None` (`checks/task_local.py:33-36` at HEAD: no env
  var or no file -> `None`). Even if it were set, `quellix_tasks` is not a dependency of
  `eval/pyproject.toml`, so the import would fail and it would still return `None` (lines 37-45).
- Therefore in `pipeline.py` (lines 104-113 at `0ed53ff`; 124-137 at HEAD) the branch
  `elif deps.task_judge is None or not config.allow_external_models` runs and returns
  `CheckOutput(error="no task model available for this organisation")`; the earlier branch
  `_critical_reject` cannot fire because no other check is enabled in the tasks rubric.
- At run time and at HEAD alike: the benchmark job gives the worker no task model. Whether
  production sets `QUELLIX_TASKS_HEAD`, and whether a trained head exists, is not known from this
  repository (`models/tasks` has the code, `head.py`, but no head file). So the 255 task reviews
  describe the benchmark's configuration; they are not established to be an artifact of it.

### Why 11 of 11 good hands clips were rejected (build timing)

- At run time (`0ed53ff`): hands@0.1.0, no `HANDS_CAN_REJECT`, no uncertain band. With the
  hands rubric (`critical: true`, both hands, manipulation, `min_ratio` 0.8) every ratio below 0.8
  rejected. `eval/reports/hands-score.md` shows hands@0.1.0 measuring 0.00-0.61 on the 11 windows
  that HoloAssist tracking labels 0.86-0.99: all 11 fail, so all 11 were rejected.
- At HEAD: `HANDS_CAN_REJECT = False` (`rubric.py:92`, #76) turns every `hands_visible.below_min`
  into review, and `HANDS_UNCERTAIN_BAND = 0.2` (`rubric.py:103`, #81) turns ratios within 0.2
  below the minimum into `uncertain`. The comments at `rubric.py:87-103` record why. So at HEAD
  none of the 117 hands rejects of this run would be a reject: they would be reviews. According
  to `hands-score.md` (hands@0.2.0 + band 0.2 on the same 124 windows, scored by the eval, not by
  this run): 2/11 good fail, 5/113 bad pass, 18/124 uncertain or error. Under HEAD's rule only a
  `pass` is decided without a person, so at most 14 of 124 hands clips (9 good + 5 bad passes)
  would be decided automatically, and 5 of them would be false accepts. This is a code reading
  plus another report's counts, not a measurement of HEAD's worker."""

STEP3_INTRO = """\
Question: if check X were correct on every clip where X is the only cause of review, how many more
clips would be decided without a person? Method (`ceiling`): on reviews with exactly one inferred
cause, replace X's status with the clip's label for X (`pass` / `fail`; `unknown` is not counted)
and re-apply the build's decision rule. "Correct" means "equal to the slice's label", whatever
the label's provenance."""

STEP3_READING = """\
**What the tables can and cannot support.**

- *tasks* and *hands*: one enabled check per slice, so the bound is trivial: every review becomes
  a decision once that check answers (255 and 6 clips). It says nothing about interactions between
  checks; in production the other checks (technical, framing, privacy, originality, hands,
  viewpoint) would also run on these clips and could add reviews of their own. The labels are
  independent (HoloAssist action annotations and hand tracking), so the bound is against real
  labels, but on a one-check rubric.
- *synthetic*: several checks run, but each variant labels only its own target check (the others
  are `unknown`) and the originals are assumed acceptable, not reviewed by a person. Every sole
  cause here is `hands_visible` error or `framing`; framing has no label on any clip, so only the
  hands errors can be counted, against assumed labels. It is a ceiling against assumed labels, on
  a handful of clips.
- No existing slice answers the cross-check question with independent labels. The experiment
  below would."""

EXPERIMENTS = """\
### Smallest experiment that would answer it (specified, not run)

- **Clips**: the 40 Egocentric-10K originals of the blind labelling kit (artifact
  `blind-labelling-kit` of both runs, `eval/labels/README.md`), plus the 255 HoloAssist task
  clips (rebuilt deterministically by `benchmark.runner`, seed 64; their labels exist).
- **Labels**: per clip and per check (technical, framing, privacy, hands_visible, task) pass /
  fail / can't tell, by an independent labeller who has not seen Ormes's output (the kit's
  protocol), plus the HoloAssist action labels already available for task. Who: the coordinator
  names the labeller; 40 clips x 20 s x 5 questions, about 1-2 person-hours. On the 255 task
  clips the other checks would still have no labels: that part bounds the task check alone.
- **Rubric**: a copy of `eval/rubrics/eval_v0.json` with `task_completed` enabled
  (`critical: true`, `min_confidence` 0.7), kept outside `eval/rubrics/`; `viewpoint` disabled in
  that copy (or reported as a new reason) because HEAD has it.
- **Worker settings**: HEAD worker, `--task-model none`, `QUELLIX_TASKS_HEAD` pointing to a trained
  head (a configured task model is required, otherwise task is always `error`; no such head is in
  the repository, see open questions), `quellix_tasks` installed, hands model weights downloaded.
  `allow_external_models` stays off: no paid API.
- **Where / runtime / cost**: GitHub-hosted `ubuntu-latest` (CPU), like the benchmark job. In run
  39783934037 (`stats` in results.json, total minus clip building) the worker phase took about
  25 min for the 255 task clips (without a task model), 15 min for the 160 synthetic clips and
  9 min for the 124 hands windows; building the HoloAssist clips took about 1 h per slice. A
  SigLIP task head on CPU adds an unmeasured amount: budget 1.5-2 h of runner time. Cost: $0 in
  Actions minutes on this repository's plan if it is public or within the included minutes;
  no API spend. It needs a new workflow or a manual job, which is outside `eval/`.
- **Output**: the same `results.json` plus each check's measurements and reason codes (the runner
  would have to keep `decision["reasons"]` and `measurements`, a change in
  `benchmark/runner.py::summarise`), so the sole-cause ceiling can be computed against
  independent labels with every check on.

### Rerun that would record real measurements (specified, not run)

- Same 124 hands windows and 255 task clips (deterministic rebuild), HEAD worker on CPU, runner
  changed to keep reasons, measurements and `CheckOutput.model` per check. It mixes code versions
  with the original run (hands@0.2.0, the uncertain band, `HANDS_CAN_REJECT = False`, the
  `viewpoint` check): compare it with this report only as "what HEAD does", never as the same
  run. At HEAD, `viewpoint` must be disabled in a rubric copy outside `eval/rubrics/` or reported
  as a new reason. Runtime about 1.5-2 h on `ubuntu-latest` (mostly clip building), $0 API
  (Gemini off: no `GEMINI_API_KEY` in that job, or `--models` empty)."""

WORK_INTRO = """\
## Ranked work list

Ranked by clips that could become automatic (upper bounds, on these slices only). Costs are
estimates to *try*, not to ship."""

WORK_HEAD = ["#", "cause", "clips affected (this run)", "upper bound that could become automatic",
             "what would have to be built or fixed", "estimated cost to try", "CPU / GPU"]
WORK_ROWS = [
    ["1", "`task_completed.error`: no task model configured in the benchmark (unknown in "
     "production)", "255 of 379 independently labelled clips (all of tasks)",
     "255 (tasks slice, one-check rubric: 125 accepts, 130 rejects if the check matched the "
     "labels)",
     "Establish whether a trained head exists and whether production sets "
     "`QUELLIX_TASKS_HEAD`; if a head exists, install `quellix_tasks` in the benchmark job and "
     "set the variable; if not, train one in `models/tasks` (HoloAssist train split; a general "
     "model only as a teacher, if approved)",
     "Scoring an existing head on the 255 clips: $0 API, under 2 h on `ubuntu-latest` (SigLIP on "
     "CPU, not measured). Training a head: not estimated here", "CPU to score; training likely "
     "GPU"],
    ["2", "Hands cannot reject at HEAD (`HANDS_CAN_REJECT = False`, #76): every hands `fail` is "
     "a review", "0 reviews in this run (build before #76); at HEAD the 117 hands rejects of "
     "this run (106 bad, 11 good) would be reviews",
     "117 automatic decisions this run had, which HEAD would send to a person; HEAD's false "
     "reject rate on good hand windows is 2/11 per `hands-score.md` (n too small)",
     "Validate the hands check at HEAD on more good clips (only 11 here) so the cap can be "
     "reconsidered; check the hands labels by eye first (overlays artifact)",
     "Labelling more good hand windows: person-hours; scoring: $0, CPU", "CPU"],
    ["3", "`hands_visible` status `error` (code ambiguous)", "6 of 124 hands clips (all bad); "
     "22 of 25 synthetic reviews (9 as only cause)",
     "6 in hands (real labels; all six would be rejects); 7 in synthetic (sole-cause clips with "
     "a hands label: 4 accepts, 3 rejects, against assumed labels)",
     "Rerun with measurements to tell `error` from `missing_measurement`, then fix the cause in "
     "the hands check", "$0, CPU, about 1.5-2 h (rerun below Step 3)", "CPU"],
    ["4", "`framing` fail (non-critical, review)", "11 of 25 synthetic reviews (3 as only cause: "
     "2 assumed-good originals, 1 hand variant)",
     "not countable: no clip has a framing label (at most 3)",
     "Framing labels (none exist), then a review of the framing thresholds",
     "Labelling: person-hours; $0 compute", "CPU"],
    ["5", "`privacy` fail with effect review (rubric: faces / documents / screens = review)",
     "6 of 25 synthetic reviews (0 as only cause)",
     "0 by design: these reviews are what the rubric asks for",
     "Nothing unless the collector's rubric changes; privacy false alarms on good clips are "
     "measured separately (#83)", "$0", "CPU"],
]


CANNOT_SHOW = """\
## What this cannot show

- The slices are not collector traffic: HoloAssist is lab footage (assembly, appliances) and the
  base rates are set by how the slices were built.
- HoloAssist hand windows are 91% bad (113 of 124), and the hand labels have not been checked by
  eye yet (`benchmark-v2.md`, notes).
- Only 11 good clips in the hands slice: no false reject rate there can be compared with a target.
- Labels come from HoloAssist annotations and hand tracking, not from a lab's acceptance.
- One-check slices (tasks, hands) hide interactions between checks: with the full rubric, other
  checks could add or remove reviews on the same clips.
- The synthetic slice's truth is assumed (originals not reviewed by a person, one labelled check
  per variant).
- results.json has no measurements, no reason codes and no model names: hands ratios and task
  confidences are not available, and reason codes are inferred (some ambiguously).
- The run used an older build than HEAD (before #76 and #81, hands@0.1.0, no `viewpoint`): its
  hands decisions are not what HEAD's worker would return.
- Nothing here says what a lab would accept."""

OPEN_QUESTIONS = """\
## Open questions

1. Does production (Modal) set `QUELLIX_TASKS_HEAD`, and does a trained task head exist anywhere?
   Until this is known the 255 task reviews describe the benchmark's configuration and are not
   called an artifact.
2. Who labels the blind Egocentric-10K kit (needed for the cross-check ceiling)?
3. Should the benchmark runner keep reason codes and measurements in results.json (a small change
   in `benchmark/runner.py::summarise`) so the next anatomy does not need inference?"""


def main(argv: Sequence[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--run", required=True, help="RUN_ID=DIR (the run to analyse)")
    ap.add_argument("--run-meta", nargs=3, metavar=("HEAD_SHA", "EVENT", "MERGE_COMMIT"),
                    default=("028f18e9e3de7d157638e636bcb5da9d20017b4e", "pull_request",
                             "0ed53ff"))
    ap.add_argument("--check-run", help="RUN_ID=DIR (a second run, determinism check)")
    ap.add_argument("--check-run-meta", nargs=2, metavar=("HEAD_SHA", "EVENT"),
                    default=("ca702ef8ddb62f034843214a7baab3875c2a5ffa", "pull_request"))
    ap.add_argument("--published", type=Path, required=True)
    ap.add_argument("--out", type=Path, required=True)
    a = ap.parse_args(argv)
    run_id, run_dir = a.run.split("=", 1)
    run = load_run(Path(run_dir))
    if not run:
        print(f"no results.json under {run_dir}", file=sys.stderr)
        return 1
    info = RunInfo(run_id, a.run_meta[0], a.run_meta[1], a.run_meta[2])
    check_run, check_info = None, None
    if a.check_run:
        cid, cdir = a.check_run.split("=", 1)
        check_run = load_run(Path(cdir))
        check_info = RunInfo(cid, a.check_run_meta[0], a.check_run_meta[1])
    a.out.parent.mkdir(parents=True, exist_ok=True)
    a.out.write_text(render_report(run, info, check_run, check_info, a.published.read_text()))
    print(a.out.read_text())
    return 0



if __name__ == "__main__":  # pragma: no cover
    sys.exit(main())
