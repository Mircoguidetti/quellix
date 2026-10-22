from quellix_eval.datasets.manifest import ClipRecord, TaskSpec
from quellix_eval.hands_report import hands_metrics, hands_section
from quellix_eval.metrics import report
from quellix_eval.run import EngineRun


def _clip(cid: str, label: str) -> ClipRecord:
    return ClipRecord(clip_id=cid, source="synthetic", license="synthetic", path=f"{cid}.mp4",
                      task=TaskSpec(description="d"), truth="reject" if "__" in cid else "accept",
                      checks={"hands_visible": label})


def _run(statuses: dict[str, tuple[str, float | None]]) -> EngineRun:
    checks = {cid: {"hands_visible": {"status": st, "measurements":
                                      {} if r is None else {"ratio_both_manipulation": r}}}
              for cid, (st, r) in statuses.items()}
    decisions = {cid: "review" for cid in statuses}
    decisions["s9__hand_truncated"] = "failed"
    return EngineRun("worker", report([("review", "reject")]), {}, 0.0, 0.0, 1, {},
                     decisions, checks_by_clip=checks)


CLIPS = [
    _clip("s0", "pass"), _clip("s1", "pass"), _clip("s2", "pass"),
    _clip("s0__hand_out_one", "fail"), _clip("s1__hands_out_both", "fail"),
    _clip("s2__hand_truncated", "fail"), _clip("s3__hand_truncated", "fail"),
    _clip("s4__no_manipulation", "uncertain"), _clip("s5__no_manipulation", "uncertain"),
    _clip("s9__hand_truncated", "fail"),            # the engine failed on it: not counted
    _clip("s6__blur", "unknown"),                   # not hands-labelled: not counted
]
RUN = _run({
    "s0": ("pass", 0.9), "s1": ("fail", 0.5), "s2": ("error", None),
    "s0__hand_out_one": ("fail", 0.4), "s1__hands_out_both": ("pass", 0.95),
    "s2__hand_truncated": ("fail", 0.3), "s3__hand_truncated": ("uncertain", None),
    "s4__no_manipulation": ("error", None), "s5__no_manipulation": ("pass", 0.9),
    "s6__blur": ("fail", 0.1),
})


def test_hands_metrics_count_rejections_against_the_base_rate():
    m = hands_metrics(RUN, CLIPS)
    assert m["clips"] == 9
    assert m["base_rate"] == 4 / 7          # 4 defects among 7 pass/fail-labelled clips
    assert m["precision"] == 2 / 3          # 2 caught, 1 false alarm (s1)
    assert m["recall"] == 2 / 4
    assert m["flag_recall"] == 3 / 4        # + the truncated clip that ended uncertain
    assert m["false_alarm_rate"] == 1 / 3
    assert m["uncertain_rate"] == 3 / 9     # s2, s3__hand_truncated, s4__no_manipulation
    assert m["static_to_review"] == 1 / 2


def test_hands_section_lists_every_kind_with_its_median_ratio():
    text = hands_section([RUN], CLIPS)
    assert "| worker | 9 | 0.57 | 0.67 | 0.50 | 0.75 | 0.33 | 0.33 | 0.50 |" in text
    assert "| hand_truncated | 2 | 0 | 1 | 1 | 0.30 (n=1) |" in text
    assert "| original | 3 | 1 | 1 | 1 | 0.70 (n=2) |" in text
    assert "| no_manipulation | 2 | 1 | 0 | 1 | 0.90 (n=1) |" in text
    assert "blur" not in text
