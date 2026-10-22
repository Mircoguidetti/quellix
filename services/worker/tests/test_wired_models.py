"""The hands and task models wired into the pipeline (issue #50), on generated frames."""

import sys
import types

import numpy as np
import pytest
from quellix_hands.model import HandsModel as RealHandsModel
from quellix_hands.types import RawHand

from quellix_worker import media
from quellix_worker.checks import hands, task_local
from quellix_worker.pipeline import Dependencies, PipelineConfig, run_pipeline
from quellix_worker.rubric import CheckOutput

from .clips import scene, write_clip

OFF = {"enabled": False}
BASE = {"id": "r1", "version": 1, "name": "t", "task": {"description": "d"}, "checks": {
    "technical": OFF, "framing": OFF, "privacy": OFF, "originality": OFF,
    "task_completed": OFF, "hands_visible": {"min_ratio": 0.8}}}


def rubric(**hands_cfg):
    r = {**BASE, "checks": {**BASE["checks"]}}
    r["checks"]["hands_visible"] = {"min_ratio": 0.8, **hands_cfg}
    return r


@pytest.fixture(scope="module")
def clip(tmp_path_factory):
    return write_clip(tmp_path_factory.mktemp("w") / "c.mp4", scene(3, 60), fps=15)


FULL_L = RawHand("left", 0.9, box=(0.15, 0.5, 0.35, 0.85))
FULL_R = RawHand("right", 0.9, box=(0.6, 0.5, 0.8, 0.85))
CUT_R = RawHand("right", 0.9, box=(0.8, 0.5, 1.0, 0.85))  # touches the frame edge


class Scripted:
    name = "scripted@test"

    def __init__(self, fn):
        self.fn, self.n = fn, 0

    def detect(self, rgb):
        self.n += 1
        return self.fn(self.n)


class Contact:
    name = "always@test"

    def __init__(self, state="object"):
        self.state = state

    def estimate(self, frames):
        # like the real estimators: an absent hand has no contact state ("unknown")
        return [{side: (self.state if f.hand(side).present else "unknown")
                 for side in ("left", "right")} for f in frames]


def model(fn, contact="object"):
    return hands.QuellixHandsAdapter(RealHandsModel(Scripted(fn), Contact(contact)))


def run(clip, hands_model, **hands_cfg):
    return run_pipeline(clip, rubric(**hands_cfg), "v1", PipelineConfig(),
                        Dependencies(hands_model=hands_model))


def status(result):
    return result.decision["checks"]["hands_visible"]["status"]


def test_both_hands_visible_while_manipulating_passes(clip):
    r = run(clip, model(lambda n: [FULL_L, FULL_R]))
    assert status(r) == "pass" and r.decision["decision"] == "accept"
    assert r.decision["checks"]["hands_visible"]["model"].startswith("hands@")
    assert r.decision["checks"]["hands_visible"]["measurements"]["ratio_both_manipulation"] == 1.0


def test_truncated_hand_fails_only_when_both_are_required(clip):
    def half_cut(n):
        return [FULL_L, CUT_R if n % 2 else FULL_R]

    r = run(clip, model(half_cut))
    assert status(r) == "fail" and r.decision["decision"] == "reject"  # ~0.5 < 0.8
    reason = next(x for x in r.decision["reasons"] if x["check"] == "hands_visible")
    assert reason["code"] == "hands_visible.below_min" and "Both hands" in reason["message"]
    assert status(run(clip, model(half_cut), require_both=False)) == "pass"  # any hand: 1.0


def test_whole_video_scope_uses_the_whole_video_ratio(clip):
    r = run(clip, model(lambda n: [FULL_L, FULL_R]), scope="whole_video")
    assert status(r) == "pass"


@pytest.mark.parametrize("scope", ["manipulation", "whole_video"])
def test_no_manipulation_is_review_never_pass_or_fail(clip, scope):
    r = run(clip, model(lambda n: [FULL_L, FULL_R], contact="none"), scope=scope)
    assert status(r) == "error" and r.decision["decision"] == "review"
    m = r.decision["checks"]["hands_visible"]["measurements"]
    assert m["manipulation_detected"] is False and "ratio_both_manipulation" not in m
    assert "ratio_both_whole" not in m  # a clean "whole" ratio would otherwise decide
    assert all(x["effect"] == "review" for x in r.decision["reasons"])


def test_no_hands_at_all_is_review(clip):
    r = run(clip, model(lambda n: []))
    assert r.decision["decision"] == "review"


def test_model_crash_is_review_not_a_failed_job(clip):
    def boom(n):
        raise RuntimeError("landmarker exploded")

    r = run(clip, model(boom))
    assert status(r) == "error" and r.decision["decision"] == "review"
    assert "landmarker exploded" in r.decision["reasons"][0]["message"]


def test_for_rubric_drops_nulls_and_ratios_without_manipulation():
    m = {"ratio_both_manipulation": None, "ratio_any_whole": 1.0, "ratio_both_whole": 1.0,
         "ratio_any_manipulation": None, "manipulation_detected": False, "note": "n"}
    out = hands.for_rubric(m)
    assert out == {"manipulation_detected": False, "note": "n"}
    low = {"ratio_both_manipulation": 0.9, "manipulation_detected": True, "low_frame_count": True}
    assert "ratio_both_manipulation" not in hands.for_rubric(low)
    ok = {"ratio_both_manipulation": 0.9, "manipulation_detected": True, "low_frame_count": False}
    assert hands.for_rubric(ok)["ratio_both_manipulation"] == 0.9


# --- configured_model: real model only when installed with weights ----------------------


@pytest.fixture(autouse=True)
def fresh_caches():
    hands.configured_model.cache_clear()
    task_local.configured_model.cache_clear()
    yield
    hands.configured_model.cache_clear()
    task_local.configured_model.cache_clear()


def test_placeholder_without_weights(clip, monkeypatch):
    monkeypatch.setenv("QUELLIX_HANDS_MODEL_PATH", "/nonexistent/hand_landmarker.task")
    assert hands.configured_model() is None
    out = hands.run(media.decode(clip))
    assert out.error == "hands model not configured"


def test_off_switch(monkeypatch):
    monkeypatch.setenv("QUELLIX_HANDS", "off")
    assert hands.configured_model() is None


def test_configured_model_is_used_when_weights_are_valid(clip, monkeypatch):
    import quellix_hands.model as qm
    import quellix_hands.weights as qw

    monkeypatch.setattr(qw, "is_valid", lambda p: True)
    created = []

    class Fake:
        model_id = "hands@fake"

        def __init__(self):
            created.append(1)

        def measure_video(self, video):
            return {"ratio_both_manipulation": 1.0, "manipulation_detected": True,
                    "n_frames": len(video.frames)}

    monkeypatch.setattr(qm, "HandsModel", Fake)
    first = hands.configured_model()
    assert first is hands.configured_model() and len(created) == 1  # created once per process
    out = hands.run(media.decode(clip))
    assert out.model == "hands@fake" and out.measurements["ratio_both_manipulation"] == 1.0


def test_start_failure_falls_back_to_the_placeholder(monkeypatch):
    import quellix_hands.model as qm
    import quellix_hands.weights as qw

    monkeypatch.setattr(qw, "is_valid", lambda p: True)

    class Broken:
        def __init__(self):
            raise RuntimeError("libEGL.so.1: cannot open shared object file")

    monkeypatch.setattr(qm, "HandsModel", Broken)
    assert hands.configured_model() is None


# --- task model: only with a trained head ------------------------------------------------


class FakeTaskModel:
    def __init__(self, completed=True, confidence=0.95, boom=False):
        self.completed, self.confidence, self.boom = completed, confidence, boom
        self.seen = None

    def run(self, rubric, frames, times_s):
        self.seen = (len(frames), list(times_s))
        if self.boom:
            raise RuntimeError("encoder out of memory")
        return CheckOutput(measurements={"completed": self.completed,
                                         "confidence": self.confidence}, model="tasks@fake")


TASK_ON = {**BASE, "checks": {**BASE["checks"], "hands_visible": OFF,
                              "task_completed": {"min_confidence": 0.7}}}


def run_task(clip, task_model=None, judge=None, allow=False):
    return run_pipeline(clip, TASK_ON, "v1", PipelineConfig(allow_external_models=allow),
                        Dependencies(task_model=task_model, task_judge=judge))


def task_status(r):
    return r.decision["checks"]["task_completed"]["status"]


def test_no_head_keeps_todays_behaviour(clip, monkeypatch):
    monkeypatch.delenv("QUELLIX_TASKS_HEAD", raising=False)
    assert task_local.configured_model() is None
    r = run_task(clip)
    assert task_status(r) == "error" and r.decision["decision"] == "review"
    monkeypatch.setenv("QUELLIX_TASKS_HEAD", "/nonexistent/head.json")
    task_local.configured_model.cache_clear()
    assert task_local.configured_model() is None


def test_head_set_but_package_missing_falls_back(clip, monkeypatch, tmp_path):
    head = tmp_path / "head.json"
    head.write_text("{}")
    monkeypatch.setenv("QUELLIX_TASKS_HEAD", str(head))
    monkeypatch.setitem(sys.modules, "quellix_tasks", None)  # import fails
    monkeypatch.setitem(sys.modules, "quellix_tasks.encoder", None)
    assert task_local.configured_model() is None


def test_task_model_decides_without_external_consent(clip):
    m = FakeTaskModel(completed=True, confidence=0.95)
    r = run_task(clip, task_model=m)  # allow_external_models False, no judge
    assert task_status(r) == "pass" and r.decision["decision"] == "accept"
    n_frames, times = m.seen
    assert n_frames == len(times) and times == sorted(times)
    assert all(b - a >= 0.9 for a, b in zip(times, times[1:], strict=False))  # ~1 fps


def test_task_model_abstaining_or_failing_goes_to_review_never_accept(clip):
    r = run_task(clip, task_model=FakeTaskModel(completed=None, confidence=0.4))
    assert task_status(r) == "uncertain" and r.decision["decision"] == "review"
    r = run_task(clip, task_model=FakeTaskModel(boom=True))
    assert task_status(r) == "error" and r.decision["decision"] == "review"
    r = run_task(clip, task_model=FakeTaskModel(completed=False, confidence=0.9))
    assert r.decision["decision"] == "reject"  # a confident "not completed" on a critical check


def test_task_model_is_skipped_after_a_critical_reject(clip):
    m = FakeTaskModel()
    rub = {**TASK_ON, "checks": {**TASK_ON["checks"], "technical": {"max_blur_ratio": 0.0}}}
    blurry = write_clip(clip.parent / "blur.mp4",
                        [np.full((120, 160, 3), 128, np.uint8)] * 30, fps=15)
    r = run_pipeline(blurry, rub, "v1", PipelineConfig(), Dependencies(task_model=m))
    assert m.seen is None and task_status(r) == "skipped"


def test_configured_task_model_is_built_from_the_head(monkeypatch, tmp_path):
    head = tmp_path / "head.json"
    head.write_text("{}")
    monkeypatch.setenv("QUELLIX_TASKS_HEAD", str(head))
    built = {}
    enc = types.ModuleType("quellix_tasks.encoder")
    enc.SiglipEncoder = lambda: "encoder"
    hd = types.ModuleType("quellix_tasks.head")
    hd.load_head = lambda path: f"head:{path}"
    mdl = types.ModuleType("quellix_tasks.model")

    class TM:
        def __init__(self, encoder, head):
            built["args"] = (encoder, head)

    mdl.TaskModel = TM
    pkg = types.ModuleType("quellix_tasks")
    for name, mod in (("quellix_tasks", pkg), ("quellix_tasks.encoder", enc),
                      ("quellix_tasks.head", hd), ("quellix_tasks.model", mdl)):
        monkeypatch.setitem(sys.modules, name, mod)
    assert isinstance(task_local.configured_model(), TM)
    assert built["args"] == ("encoder", f"head:{head}")
