import json

import pytest

from quellix_eval import review_anatomy as ra
from quellix_eval.benchmark.report import render
from quellix_eval.benchmark.stats import Rate, wilson

OFF = {"enabled": False}
ONE_CHECK = {"id": "r", "version": 1, "checks": {
    "task_completed": {"enabled": True, "critical": True, "min_confidence": 0.7},
    "hands_visible": OFF, "framing": OFF, "technical": OFF, "privacy": OFF, "originality": OFF}}
MULTI = {"id": "m", "version": 1, "checks": {
    "task_completed": OFF,
    "hands_visible": {"enabled": True, "critical": True, "scope": "manipulation",
                      "require_both": True, "min_ratio": 0.8},
    "framing": {"enabled": True, "critical": False},
    "technical": {"enabled": True, "critical": True},
    "privacy": {"enabled": True, "faces": "review", "documents": "review", "screens": "review"},
    "originality": {"enabled": True, "on_duplicate": "reject"}}}


def clip(cid, truth, **labels):
    return {"clip_id": cid, "truth": truth, "checks": labels}


def res(decision, not_run=False, **checks):
    return {"decision": decision, "checks": checks, "error": None, "not_run": not_run,
            "cost_usd": 0.0, "latency_s": 1.0}


def slice_(name, rubric, clips, worker, gemini=None):
    engines = {"worker": worker}
    if gemini is not None:
        engines["gemini:cheap"] = gemini
    return {"slice": name, "rubric": rubric, "clips": clips, "engines": engines,
            "spend": {"cap_usd": 1.0, "spent_usd": 0.0, "by_model": {}}, "stats": {}}


def tasks_slice():
    clips = [clip(f"t{i}", "accept" if i % 2 else "reject",
                  task_completed="pass" if i % 2 else "fail") for i in range(6)]
    worker = {c["clip_id"]: res("review", task_completed="error") for c in clips}
    worker["t0"] = res("reject", task_completed="fail")
    worker["t1"] = res(None)                                     # failed worker run
    worker["t2"] = res(None, not_run=True)                       # never reached
    return slice_("tasks", ONE_CHECK, clips, worker)


def test_counts_not_run_and_null_decision():
    a = ra.anatomy(tasks_slice())
    assert (a.clips, a.not_run, a.ran, a.null_decision) == (6, 1, 5, 1)
    assert a.count("reject", "reject") == 1
    assert a.count("accept", "review") == 3          # t1 (null -> review), t3, t5
    assert a.count("reject", "review") == 1          # t4
    assert a.decided == Rate(1, 5)
    assert a.base_reject == Rate(2, 5)
    assert a.frr == Rate(0, 3) and a.far == Rate(0, 2)
    assert a.causes["task_completed.error"] == 3
    assert a.causes["no decision (worker run failed)"] == 1
    assert not a.inconsistent


def test_wilson_interval_is_the_stats_one():
    a = ra.anatomy(tasks_slice())
    assert a.decided.ci == wilson(1, 5)
    lo, hi = wilson(1, 5)  # type: ignore[misc]
    assert lo == pytest.approx(0.0362, abs=1e-3) and hi == pytest.approx(0.6245, abs=1e-3)


def test_tasks_error_is_the_only_cause_by_construction():
    a = ra.anatomy(tasks_slice())
    assert a.sole["task_completed.error"] == a.causes["task_completed.error"]


def test_sole_cause_on_a_multi_check_rubric():
    base = {"technical": "pass", "originality": "pass", "privacy": "pass", "framing": "pass",
            "hands_visible": "pass", "task_completed": "skipped"}
    clips = [clip("a", "accept", hands_visible="pass"), clip("b", "reject", privacy="fail"),
             clip("c", "accept"), clip("d", "reject", technical="fail")]
    worker = {
        "a": res("review", **{**base, "hands_visible": "error"}),
        "b": res("review", **{**base, "hands_visible": "error", "privacy": "fail"}),
        "c": res("review", **{**base, "framing": "fail"}),
        "d": res("reject", **{**base, "technical": "fail", "framing": "fail"}),
    }
    a = ra.anatomy(slice_("synthetic", MULTI, clips, worker))
    assert a.causes[ra.HANDS_AMBIGUOUS] == 2
    assert a.sole[ra.HANDS_AMBIGUOUS] == 1          # only "a"; "b" also has privacy
    assert a.sole["framing.off_target or framing.unstable"] == 1
    assert "privacy.faces or privacy.documents or privacy.screens" not in a.sole
    assert not a.inconsistent                        # a critical fail rejects despite framing


def test_hands_fail_rejects_at_the_run_build_and_reviews_after_76():
    st = {"hands_visible": "fail", "technical": "pass", "framing": "pass", "privacy": "pass",
          "originality": "pass"}
    assert ra.expected_decision(MULTI, st) == "reject"
    later = ra.BuildRules(hands_can_reject=False)
    assert ra.expected_decision(MULTI, st, later) == "review"
    assert ra.review_causes(MULTI, st, later) == ["hands_visible.below_min"]


def test_disabled_checks_and_skips():
    assert ra.review_causes(ONE_CHECK, {"task_completed": "pass", "hands_visible": "skipped"}) == []
    assert ra.review_causes(ONE_CHECK, {"task_completed": "skipped"}) == [
        "pipeline.skipped_without_reject"]
    assert ra.review_causes(ONE_CHECK, {}) == ["task_completed.missing_status"]
    assert ra.review_causes(ONE_CHECK, {"task_completed": "uncertain"}) == [
        "task_completed.uncertain"]


def test_gap_and_n_under_30():
    assert ra.gap(Rate(11, 11), ra.TARGET_FRR, at_least=False) == "n too small"
    assert ra.gap(Rate(0, 29), ra.TARGET_DECIDED, at_least=True) == "n too small"
    assert ra.gap(Rate(118, 379), ra.TARGET_DECIDED, at_least=True) == "38.9"
    assert ra.gap(Rate(11, 136), ra.TARGET_FRR, at_least=False) == "3.1"
    assert ra.gap(Rate(1, 243), ra.TARGET_FAR, at_least=False) == "0.0"


def test_pooled_adds_slices():
    t = ra.anatomy(tasks_slice())
    p = ra.pooled([t, t], "pooled")
    assert p.ran == 10 and p.decided == Rate(2, 10) and p.null_decision == 2


def test_ceiling_replaces_the_only_cause_with_its_label():
    c = ra.ceiling(tasks_slice())["task_completed"]
    assert (c.sole_reviews, c.labelled, c.to_accept, c.to_reject) == (3, 3, 2, 1)
    assert c.accept_truth == {"accept": 2} and c.reject_truth == {"reject": 1}


def test_ceiling_skips_unknown_labels():
    clips = [clip("x", "accept")]
    worker = {"x": res("review", technical="pass", originality="pass", privacy="pass",
                       framing="fail", hands_visible="pass")}
    c = ra.ceiling(slice_("synthetic", MULTI, clips, worker))["framing"]
    assert (c.sole_reviews, c.labelled) == (1, 0)


def test_reproduce_matches_its_own_render_and_flags_a_change():
    clips = [clip(f"h{i}", "reject" if i < 4 else "accept",
                  hands_visible="fail" if i < 4 else "pass") for i in range(6)]
    one = {"hands_visible": "fail"}
    worker = {c["clip_id"]: res("reject", **one) for c in clips}
    gem = {c["clip_id"]: res("reject", **one) for c in clips}
    gem["h5"] = res(None, not_run=True)
    rub = {**ONE_CHECK, "checks": {**ONE_CHECK["checks"], "task_completed": OFF,
                                   "hands_visible": MULTI["checks"]["hands_visible"]}}
    s = [slice_("hands", rub, clips, worker, gem)]
    md = render(s)
    rep = ra.reproduce(s, md)
    assert rep.compared >= 3 and rep.mismatches == []
    changed = md.replace("(4/4)", "(3/4)", 1)
    assert ra.reproduce(s, changed).mismatches


def test_main_writes_the_report(tmp_path):
    run = tmp_path / "run"
    (run / "benchmark-tasks").mkdir(parents=True)
    s = tasks_slice()
    (run / "benchmark-tasks" / "results.json").write_text(json.dumps(s))
    pub = tmp_path / "pub.md"
    pub.write_text(render([s]))
    out = tmp_path / "anatomy.md"
    assert ra.main(["--run", f"1={run}", "--published", str(pub), "--out", str(out)]) == 0
    text = out.read_text()
    assert "**0 differences**" in text and "`task_completed.error`" in text
