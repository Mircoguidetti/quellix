"""Contributor feedback (issue #22 part 2): hints, segments and visibility on every reason."""

import json
import re
from pathlib import Path

import numpy as np

from quellix_worker import feedback, media
from quellix_worker.checks import framing, technical
from quellix_worker.checks.segments import flagged_runs, runs
from quellix_worker.contracts import load_example, validate_decision
from quellix_worker.pipeline import Dependencies, PipelineConfig, run_pipeline
from quellix_worker.rubric import CheckOutput, evaluate

from .clips import scene, write_clip

SRC = Path(__file__).parents[1] / "src" / "quellix_worker"
RUBRIC = load_example("rubric.load_dishwasher.json")


# --- the table covers everything the rubric can say --------------------------------------


def rubric_codes() -> set[str]:
    codes = set(re.findall(r'"((?:task_completed|hands_visible|framing|technical|originality|'
                           r'pipeline)\.[a-z_]+)"', (SRC / "rubric.py").read_text()))
    codes |= {f"privacy.{k}" for k in ("faces", "documents", "screens")}
    return codes


def test_every_code_the_rubric_can_emit_has_an_entry():
    missing = {c for c in rubric_codes() if feedback.HINTS.get(c) is None
               and not c.startswith(feedback.HIDDEN_PREFIXES)}
    assert not missing, f"add these to feedback.HINTS: {sorted(missing)}"


def test_hidden_codes_are_never_visible_and_visible_codes_have_a_hint():
    for code, entry in feedback.HINTS.items():
        assert entry.visible == (entry.hint is not None), code
    for code in ("originality.duplicate", "originality.anything", "technical.error",
                 "pipeline.skipped_without_reject", "privacy.error"):
        assert feedback.entry_for(code).visible is False
    for code in rubric_codes():
        e = feedback.entry_for(code)
        if e is not None and e.visible:
            assert e.hint is not None


def reasons_for(measurements: dict, overrides: dict | None = None):
    rubric = {**RUBRIC, "checks": {**RUBRIC["checks"], **(overrides or {})}}
    outputs = {name: CheckOutput(measurements=m, model="t") for name, m in measurements.items()}
    return rubric, evaluate("v", rubric, outputs)


def test_hint_texts_are_filled_from_the_rubric_and_short():
    rubric, d = reasons_for({
        "technical": {"decodable": True, "duration_s": 5, "width": 640, "height": 360, "fps": 15,
                      "blur_ratio": 0.5, "bad_exposure_ratio": 0.5},
    })
    out = feedback.annotate(d, rubric)
    by_code = {r["code"]: r for r in out["reasons"]}
    assert "at least 20 seconds" in by_code["technical.too_short"]["hint"]
    assert "1280×720" in by_code["technical.low_resolution"]["hint"]
    assert "24 frames per second" in by_code["technical.low_fps"]["hint"]
    for r in out["reasons"]:
        if r["contributor_visible"]:
            assert 0 < len(r["hint"]) <= feedback.MAX_HINT_CHARS, r["code"]


def test_too_long_uses_minutes():
    rubric, d = reasons_for({"technical": {"decodable": True, "duration_s": 900, "width": 1920,
                                           "height": 1080, "fps": 30, "blur_ratio": 0,
                                           "bad_exposure_ratio": 0}})
    hint = next(r for r in feedback.annotate(d, rubric)["reasons"]
                if r["code"] == "technical.too_long")["hint"]
    assert "10 minutes" in hint


# --- visibility ---------------------------------------------------------------------------


def test_duplicates_never_carry_a_hint_or_segments_or_visibility():
    rubric, d = reasons_for({"originality": {"max_similarity": 0.97, "match_video_id": "other"}})
    out = feedback.annotate(d, rubric)
    dup = next(r for r in out["reasons"] if r["code"] == "originality.duplicate")
    assert dup["contributor_visible"] is False
    assert "hint" not in dup and "segments" not in dup
    validate_decision(out)


def test_errors_and_pipeline_notes_are_hidden():
    rubric = RUBRIC
    d = evaluate("v", rubric, {"technical": CheckOutput(error="boom")})
    out = feedback.annotate(d, rubric)
    errors = [r for r in out["reasons"] if r["code"].endswith(".error")]
    assert errors and all(r["contributor_visible"] is False and "hint" not in r for r in errors)
    d["reasons"].append({"check": "technical", "code": "something.new", "message": "m",
                         "effect": "review"})
    assert feedback.annotate(d, rubric)["reasons"][-1]["contributor_visible"] is False


def test_annotate_does_not_change_the_input_and_sets_the_schema_version():
    rubric, d = reasons_for({"technical": {"decodable": False}})
    before = json.dumps(d)
    out = feedback.annotate(d, rubric)
    assert json.dumps(d) == before and out["schema_version"] == 2
    assert out["decision"] == d["decision"] and out["checks"] == d["checks"]
    unreadable = next(r for r in out["reasons"] if r["code"] == "technical.not_decodable")
    assert "export it again as MP4" in unreadable["hint"]


# --- segments -------------------------------------------------------------------------------


def test_runs_merge_close_samples_and_cover_each_sample():
    assert runs([1.0, 1.25, 1.5, 4.0], 0.25) == [[1.0, 1.75], [4.0, 4.25]]
    assert runs([0.0, 0.9, 1.8], 0.25) == [[0.0, 2.05]]  # gaps <= 1 s are bridged
    assert runs([], 0.25) == []
    assert flagged_runs([0, 1, 2, 10], [True, False, True, True], 0.5) == [
        [0.0, 0.5], [2.0, 2.5], [10.0, 10.5]]


def test_clean_segments_clip_merge_and_drop():
    got = feedback.clean_segments([[-2, 3], [3.5, 4], [20, 25], [9, 8]], 10.0)
    assert got == [[0.0, 4.0]]  # clipped at 0, merged (gap 0.5 s), after-the-end and empty dropped
    assert feedback.clean_segments([[8, 14]], 10.0) == [[8.0, 10.0]]  # clipped at the end


def test_blur_and_exposure_segments_on_a_clip_with_a_blurry_middle(tmp_path):
    import cv2

    frames = scene(1, 90, size=(320, 180))
    frames = [cv2.GaussianBlur(f, (0, 0), 8) if 30 <= i < 60 else f for i, f in enumerate(frames)]
    m = technical.run(media.decode(write_clip(tmp_path / "b.mp4", frames, fps=15))).measurements
    segs = m["blur_segments"]
    assert len(segs) == 1 and 1.5 <= segs[0][0] <= 2.5 and 3.5 <= segs[0][1] <= 4.5  # 2 s - 4 s
    assert m["bad_exposure_segments"] == []


def test_unstable_segments_follow_the_shaky_part(tmp_path):
    base = scene(2, 1, size=(320, 180))[0]
    rng = np.random.default_rng(0)
    frames = [base.copy() for _ in range(60)]
    frames += [np.roll(base, int(rng.integers(-60, 60)), 1) for _ in range(60)]
    m = framing.run(media.decode(write_clip(tmp_path / "s.mp4", frames, fps=30))).measurements
    segs = m["unstable_segments"]
    assert segs and all(a >= 1.5 for a, _ in segs) and segs[-1][1] <= 4.3  # shaking is 2-4 s


def test_pipeline_emits_v2_decisions_with_hints_and_segments(tmp_path):
    import cv2

    frames = [cv2.GaussianBlur(f, (0, 0), 8) for f in scene(3, 60, size=(320, 180))]
    clip = write_clip(tmp_path / "blur.mp4", frames, fps=15)
    rubric = {**RUBRIC, "checks": {"technical": {"critical": True, "max_blur_ratio": 0.05},
                                   "task_completed": {"enabled": False},
                                   "hands_visible": {"enabled": False},
                                   "framing": {"enabled": False}, "privacy": {"enabled": False},
                                   "originality": {"enabled": False}}}
    r = run_pipeline(clip, rubric, "v1", PipelineConfig(), Dependencies())
    d = r.decision
    validate_decision(d)
    assert d["schema_version"] == 2 and d["decision"] == "reject"
    blur = next(x for x in d["reasons"] if x["code"] == "technical.blurry")
    assert blur["contributor_visible"] is True and blur["hint"].startswith("Clean the lens")
    assert blur["segments"][0]["start_s"] == 0.0 and blur["segments"][-1]["end_s"] <= 4.1
    json.dumps(d)


# --- hands, privacy, task segments -------------------------------------------------------------


def test_hands_segments_follow_scope_and_require_both():
    m = {"not_both_full_manipulation_segments": [[1.0, 2.0]],
         "not_any_full_manipulation_segments": [[5.0, 6.0]],
         "not_both_full_whole_segments": [[0.0, 3.0]], "not_any_full_whole_segments": [[7.0, 8.0]],
         "manipulation_segments": [[0.0, 10.0]]}
    assert feedback._hands_segments(m, {"require_both": True, "scope": "manipulation"}) == [[1, 2]]
    assert feedback._hands_segments(m, {"require_both": False, "scope": "manipulation"}) == [[5, 6]]
    assert feedback._hands_segments(m, {"require_both": True, "scope": "whole_video"}) == [[0, 3]]
    assert feedback._hands_segments(m, {"require_both": False, "scope": "whole_video"}) == [[7, 8]]
    assert feedback._hands_segments({"manipulation_segments": [[0.0, 10.0]]},
                                    {"require_both": True, "scope": "manipulation"}) == [[0, 10]]
    assert "both hands" in feedback._hands_hint({"require_both": True}, {}).lower()
    assert "both" not in feedback._hands_hint({"require_both": False}, {}).lower()


def test_hands_adapter_reports_exact_intervals(tmp_path):
    from quellix_hands.model import HandsModel as RealHandsModel
    from quellix_hands.types import RawHand

    from quellix_worker.checks import hands

    full_l = RawHand("left", 0.9, box=(0.15, 0.5, 0.35, 0.85))
    full_r = RawHand("right", 0.9, box=(0.6, 0.5, 0.8, 0.85))
    cut_r = RawHand("right", 0.9, box=(0.8, 0.5, 1.0, 0.85))

    class Det:
        name = "t"
        n = 0

        def detect(self, rgb):
            self.n += 1
            return [full_l, cut_r if 9 <= self.n < 17 else full_r]  # frames 9-16 cut: 2.0-4.0 s

    class Contact:
        name = "c"

        def estimate(self, frames):
            return [{"left": "object", "right": "object"} for _ in frames]

    clip = write_clip(tmp_path / "h.mp4", scene(4, 80, size=(320, 180)), fps=10)
    video = media.decode(clip)
    out = hands.QuellixHandsAdapter(RealHandsModel(Det(), Contact())).predict(video)
    segs = out.measurements["not_both_full_manipulation_segments"]
    assert len(segs) == 1 and 1.9 <= segs[0][0] <= 2.3 and 3.9 <= segs[0][1] <= 4.5
    assert out.measurements["not_any_full_manipulation_segments"] == []  # one hand always full
    rubric = {**RUBRIC, "checks": {**RUBRIC["checks"], "hands_visible": {"min_ratio": 0.9}}}
    d = evaluate("v", rubric, {"hands_visible": out})
    ann = feedback.annotate(d, rubric, duration_s=8.0)
    reason = next(r for r in ann["reasons"] if r["code"] == "hands_visible.below_min")
    assert reason["segments"][0]["start_s"] < 2.5 and "both hands" in reason["hint"].lower()


def test_privacy_segments_are_runs_of_detection_times():
    m = {"faces": [{"t_s": 5.0, "box": [0, 0, 1, 1]}, {"t_s": 5.5, "box": [0, 0, 1, 1]},
                   {"t_s": 30.0, "box": [0, 0, 1, 1]}]}
    assert feedback._privacy_segments("faces")(m, {}) == [[5.0, 5.5], [30.0, 30.0]]


def test_task_segment_runs_from_the_end_of_the_task_to_the_end_of_the_video():
    rubric = {**RUBRIC, "checks": {"task_completed": {"min_confidence": 0.5}}}
    d = evaluate("v", rubric, {"task_completed": CheckOutput(
        measurements={"completed": False, "confidence": 0.9, "end_s": 20.0}, model="t")})
    out = feedback.annotate(d, rubric, duration_s=45.0)
    r = next(x for x in out["reasons"] if x["code"] == "task_completed.not_completed")
    assert r["segments"] == [{"start_s": 20.0, "end_s": 45.0}]
    assert "door closed with items inside" in r["hint"]  # the rubric's final_state


def test_the_shared_vector_from_the_contract_validates():
    validate_decision(load_example("decision.feedback.json"))
