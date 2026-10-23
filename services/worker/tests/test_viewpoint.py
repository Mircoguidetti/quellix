"""Viewpoint check (#79): evidence, verdict, rubric codes, cap, hint, contract gate."""

from __future__ import annotations

import numpy as np
import pytest

from quellix_worker import feedback, pipeline
from quellix_worker import rubric as rubric_module
from quellix_worker.checks import viewpoint as vp
from quellix_worker.contracts import load_example, validate_decision, validate_rubric
from quellix_worker.rubric import CheckOutput, evaluate

from .test_rubric import good_outputs

RUBRIC = load_example("rubric.load_dishwasher.json")
ALL = rubric_module.CHECK_NAMES


def hand(wrist, knuckle, state="full") -> vp.HandView:
    return vp.HandView(state, {vp.WRIST: wrist, vp.MIDDLE_MCP: knuckle})


UP = hand((0.5, 0.9), (0.5, 0.75))          # forearm from the bottom, fingers up the frame
DOWN = hand((0.5, 0.3), (0.5, 0.45))        # seen from the front: fingers down
SIDE = hand((0.2, 0.5), (0.35, 0.5))


def test_pointing_up_and_scale():
    assert vp.pointing_up(UP, 16 / 9) == pytest.approx(1.0)
    assert vp.pointing_up(DOWN, 16 / 9) == pytest.approx(-1.0)
    assert vp.pointing_up(SIDE, 16 / 9) == pytest.approx(0.0)
    assert vp.hand_scale(UP, 1.0) == pytest.approx(0.15)
    assert vp.pointing_up(vp.HandView("full", {}), 1.0) is None


def test_hands_pointing_up_on_a_moving_camera_are_first_person():
    m = vp.measure([[UP]] * 20, 16 / 9, faces=0.0, shifts=[0.01] * 20)
    assert m["viewpoint"] == "first_person" and m["first_person_ratio"] == 1.0
    assert 0 < m["confidence"] <= 1


def test_hands_across_the_frame_are_third_person():
    m = vp.measure([[SIDE]] * 20, 16 / 9, faces=0.0, shifts=[0.01] * 20)
    assert m["viewpoint"] == "third_person" and m["first_person_ratio"] == 0.0


def test_hands_down_from_the_top_are_uncertain_could_be_an_upside_down_head_camera():
    m = vp.measure([[DOWN]] * 20, 16 / 9, faces=0.0, shifts=[0.01] * 20)
    assert m["viewpoint"] == "uncertain" and "upside down" in m["uncertain_why"]


def test_a_face_blocks_first_person_but_a_still_camera_does_not():
    m = vp.measure([[UP]] * 20, 1.5, faces=0.5, shifts=[0.01] * 20)
    assert m["viewpoint"] == "uncertain" and "face" in m["uncertain_why"]
    m = vp.measure([[UP]] * 20, 1.5, faces=0.0, shifts=[0.0] * 20)
    assert m["viewpoint"] == "first_person" and m["still_share"] == 1.0


def test_mixed_or_too_few_hands_is_uncertain():
    assert vp.measure([[UP]] * 2 + [[]] * 20, 1.5, 0.0, [0.01] * 20)["viewpoint"] == "uncertain"
    assert vp.measure([[]] * 20, 1.5, 0.6, [0.01] * 20)["viewpoint"] == "uncertain"
    assert vp.measure([[UP], [SIDE]] * 10, 1.5, 0.0, [0.01] * 20)["viewpoint"] == "uncertain"


def test_face_share_counts_analysed_frames():
    faces = [{"t_s": 0.5, "box": [0, 0, 0.1, 0.1]}, {"t_s": 1.0, "box": [0, 0, 0.1, 0.1]}]
    assert vp.face_share(faces, [0.0, 0.5, 1.0, 1.5]) == 0.5
    assert vp.face_share([], []) == 0.0


def test_camera_shifts_still_vs_moving():
    rng = np.random.default_rng(0)
    a = rng.integers(0, 255, (64, 96)).astype(np.uint8)
    b = np.roll(a, 5, axis=1)
    still, moving = vp.camera_shifts([(a, a), (a, b)])
    assert still is not None and still < vp.STILL_SHIFT
    assert moving == pytest.approx(5 / 96, abs=0.01)


def test_run_without_landmarks_is_an_error_not_a_verdict():
    class V:
        frames = [type("F", (), {"rgb": np.zeros((4, 4, 3), np.uint8), "t_s": 0.0})()]
        motion_pairs: list = []

    out = vp.run(V(), None, None)
    assert out.error and out.measurements is None


# --- rubric ------------------------------------------------------------------------------


def decide(view: str | None, required: str = "first_person", critical: bool = True,
           validate: bool = True) -> dict:
    rubric = {**RUBRIC, "checks": {**RUBRIC["checks"],
                                   "viewpoint": {"required": required, "critical": critical}}}
    o = good_outputs()
    o["viewpoint"] = CheckOutput({"viewpoint": view, "first_person_ratio": 0.1,
                                  "confidence": 0.9} if view else {"hand_frames": 0})
    d = feedback.annotate(evaluate("v", rubric, o, ALL), rubric)
    if validate:
        validate_rubric(rubric)
        validate_decision(d)
    return d


def test_matching_viewpoint_passes():
    d = decide("first_person")
    assert d["decision"] == "accept" and d["checks"]["viewpoint"]["status"] == "pass"
    assert decide("third_person", required="third_person")["decision"] == "accept"
    assert decide("third_person", required="any")["decision"] == "accept"


def test_wrong_viewpoint_is_review_never_reject_until_validated():
    assert rubric_module.VIEWPOINT_CAN_REJECT is False
    d = decide("third_person")
    (r,) = d["reasons"]
    assert d["decision"] == "review" and r["code"] == "viewpoint.wrong"
    assert r["effect"] == "review" and "third-person" in r["message"]
    assert r["hint"].startswith("Record with the camera on your head or chest")
    m = d["checks"]["viewpoint"]["measurements"]
    assert m["reject_capped_to_review"] is True and "#79" in m["reject_cap_note"]


def test_wrong_viewpoint_rejects_once_the_flag_flips(monkeypatch):
    monkeypatch.setattr(rubric_module, "VIEWPOINT_CAN_REJECT", True)
    assert decide("third_person")["decision"] == "reject"
    assert decide("third_person", critical=False)["decision"] == "review"


def test_third_person_order_gets_the_tripod_hint():
    (r,) = decide("first_person", required="third_person")["reasons"]
    assert r["code"] == "viewpoint.wrong" and r["hint"].startswith("Film from a tripod")


def test_uncertain_goes_to_review():
    d = decide(None)
    (r,) = d["reasons"]
    assert d["decision"] == "review" and r["code"] == "viewpoint.uncertain"
    assert d["checks"]["viewpoint"]["status"] == "uncertain"


def test_disabled_viewpoint_is_skipped():
    rubric = {**RUBRIC, "checks": {**RUBRIC["checks"], "viewpoint": {"enabled": False}}}
    o = good_outputs()
    del o["viewpoint"]
    d = evaluate("v", rubric, o, ALL)
    assert d["decision"] == "accept" and d["checks"]["viewpoint"]["status"] == "skipped"


def test_the_pipeline_runs_the_check_only_when_the_contract_knows_it(monkeypatch):
    known = pipeline.known_checks()
    assert ("viewpoint" in pipeline.active_checks()) == ("viewpoint" in known)
    monkeypatch.setattr(pipeline, "known_checks", lambda: frozenset(ALL))
    assert "viewpoint" in pipeline.active_checks()


def test_pipeline_runs_the_check_once_the_contract_knows_it(monkeypatch, tmp_path):
    from quellix_hands.types import FrameHands, HandObservation

    from quellix_worker.pipeline import Dependencies, PipelineConfig, run_pipeline

    from .clips import scene, write_clip

    kp = np.zeros((21, 2))
    kp[vp.WRIST], kp[vp.MIDDLE_MCP] = (0.5, 0.9), (0.5, 0.7)

    class Hands:
        name = "hands@fake"

        def predict_with_frames(self, video):
            states = [FrameHands(f.t_s, HandObservation("left", "full", 0.9, kp),
                                 HandObservation("right", "absent")) for f in video.frames]
            return CheckOutput({"ratio_both_manipulation": 0.9, "ratio_any_manipulation": 0.9,
                                "ratio_both_whole": 0.9, "ratio_any_whole": 0.9},
                               model=self.name), states

        def predict(self, video):
            return self.predict_with_frames(video)[0]

    class NoFaces:
        def detect(self, rgb):
            return []

    monkeypatch.setattr(pipeline, "known_checks", lambda: frozenset(ALL))
    clip = write_clip(tmp_path / "c.mp4", scene(1, 60), fps=15)
    r = run_pipeline(clip, RUBRIC, "v1", PipelineConfig(),
                     Dependencies(hands_model=Hands(), face_detector=NoFaces()))
    v = r.decision["checks"]["viewpoint"]
    assert v["status"] == "pass" and v["measurements"]["viewpoint"] == "first_person"
    assert r.models["viewpoint"] == vp.MODEL and "viewpoint" in r.timings_ms


# --- head in view (over-the-shoulder shots) ------------------------------------------------


def test_head_share_counts_frames_with_enough_hair():
    assert vp.head_share([]) is None
    assert vp.head_share([0.0, 0.05, 0.01, 0.10]) == 0.5


def test_a_head_in_view_blocks_first_person():
    m = vp.measure([[UP]] * 20, 1.5, faces=0.0, shifts=[0.01] * 20, heads=0.6)
    assert m["viewpoint"] == "uncertain" and "over the shoulder" in m["uncertain_why"]
    m = vp.measure([[UP]] * 20, 1.5, faces=0.0, shifts=[0.01] * 20, heads=0.0)
    assert m["viewpoint"] == "first_person" and m["head_share"] == 0.0


def _video(n=20):
    class F:
        def __init__(self, t):
            self.t_s, self.rgb = t, np.zeros((36, 64, 3), np.uint8)

    class V:
        frames = [F(i * 0.25) for i in range(n)]
        motion_pairs: list = []

    return V()


def _states(n=20):
    from quellix_hands.types import FrameHands, HandObservation

    kp = np.zeros((21, 2))
    kp[vp.WRIST], kp[vp.MIDDLE_MCP] = (0.5, 0.9), (0.5, 0.7)
    return [FrameHands(i * 0.25, HandObservation("left", "full", 0.9, kp),
                       HandObservation("right", "absent")) for i in range(n)]


def test_run_uses_the_segmenter_on_every_analysed_frame():
    class Seg:
        calls = 0

        def hair_share(self, rgb):
            Seg.calls += 1
            return 0.3

    out = vp.run(_video(), _states(), None, 2, Seg())
    assert Seg.calls == 10 and out.measurements["head_share"] == 1.0
    assert out.measurements["viewpoint"] == "uncertain"


def test_run_without_a_segmenter_says_so(monkeypatch):
    monkeypatch.setattr(vp, "configured_segmenter", lambda: None)
    m = vp.run(_video(), _states(), None).measurements
    assert m["viewpoint"] == "first_person" and m["head_share"] is None
    assert m["head_evidence"] == "segmenter not available"
