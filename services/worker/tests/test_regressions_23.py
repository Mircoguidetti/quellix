"""Regression tests for the first real eval (issue #23)."""

import json
from pathlib import Path

import cv2
import numpy as np
import pytest

from quellix_worker import media
from quellix_worker.checks import framing, privacy
from quellix_worker.checks import originality as orig
from quellix_worker.contracts import validate_decision
from quellix_worker.jsonable import to_py
from quellix_worker.pipeline import Dependencies, PipelineConfig, run_pipeline

from .clips import scene, write_clip

EVAL_RUBRIC = json.loads(
    (Path(__file__).parents[3] / "eval" / "rubrics" / "eval_v0.json").read_text())


def have_models() -> bool:
    try:
        privacy.yunet_path()
        privacy.text_model_path()
        return True
    except Exception:  # offline sandbox
        return False


needs_models = pytest.mark.skipif(not have_models(), reason="model weights unavailable")


# --- 1. numpy scalars never reach JSON -------------------------------------------------


def test_to_py_converts_numpy():
    out = to_py({"a": np.float32(0.5), "b": [np.int64(3), (np.float32(1.5),)],
                 "c": np.arange(2, dtype=np.float32), "d": np.bool_(True)})
    assert json.loads(json.dumps(out)) == {"a": 0.5, "b": [3, [1.5]], "c": [0.0, 1.0], "d": True}
    assert type(out["a"]) is float


class Float32Faces:
    """What YuNet really returns: float32 boxes."""

    def detect(self, rgb):
        return [tuple(np.float32(v) for v in (0.1, 0.1, 0.2, 0.2))]


class Float32Regions:
    def detect(self, rgb):
        return [(np.float32(0.5), np.float32(0.1), np.float32(0.4), np.float32(0.6))]


def test_every_check_output_is_json_serialisable(tmp_path):
    clip = write_clip(tmp_path / "c.mp4", scene(3, 60), fps=15)
    rubric = {**EVAL_RUBRIC, "checks": {"privacy": {"faces": "review", "documents": "review",
                                                    "screens": "review"}}}
    deps = Dependencies(face_detector=Float32Faces())
    result = run_pipeline(clip, rubric, "v1", PipelineConfig(), deps)
    json.dumps(result.decision)  # was: TypeError float32 is not JSON serializable
    validate_decision(result.decision)
    out = privacy.run(media.decode(clip), faces=Float32Faces(), documents=Float32Regions(),
                      screens=Float32Regions())
    json.dumps(out.measurements)


@needs_models
def test_real_privacy_models_output_is_serialisable(tmp_path):
    from tests.test_privacy_overlays import background, document  # noqa: PLC0415

    out = privacy.run(media.decode(write_clip(
        tmp_path / "f.mp4", [document(background()) for _ in range(10)], fps=10)))
    assert out.measurements is not None and out.measurements["documents"]
    json.dumps(out.measurements)


# --- 2. disabled checks never produce reasons; a clean clip is accepted ---------------------


def test_clean_clip_is_accepted_when_hands_and_task_are_disabled(tmp_path):
    clip = write_clip(tmp_path / "c.mp4", scene(4, 100), fps=15)
    rubric = {**EVAL_RUBRIC, "checks": {**EVAL_RUBRIC["checks"], "privacy": {"enabled": False},
                                        "hands_visible": {"enabled": False},
                                        # without a hands model there are no landmarks, so the
                                        # viewpoint check (#79) would rightly say "review"
                                        "viewpoint": {"enabled": False}}}
    result = run_pipeline(clip, rubric, "v1", PipelineConfig(), Dependencies())
    assert result.decision["decision"] == "accept", result.decision["reasons"]
    for name in ("hands_visible", "task_completed"):
        assert result.decision["checks"][name]["status"] == "skipped"
    assert not any(r["check"] in ("hands_visible", "task_completed")
                   for r in result.decision["reasons"])


def test_framing_does_not_flag_ordinary_head_motion(tmp_path):
    # A slow pan with objects moving in the scene: ~0.1 frame widths per second.
    base = scene(5, 1, size=(320, 180))[0]
    big = cv2.resize(base, (640, 180))
    frames = [np.ascontiguousarray(big[:, int(i * 1.5): int(i * 1.5) + 320]) for i in range(90)]
    m = framing.run(media.decode(write_clip(tmp_path / "p.mp4", frames, fps=30))).measurements
    assert m["unstable_ratio"] == 0.0 and m["off_target_ratio"] == 0.0


def test_framing_flags_whip_pans_and_blank_frames(tmp_path):
    base = scene(6, 1, size=(320, 180))[0]
    rng = np.random.default_rng(0)
    shaky = [np.roll(base, int(rng.integers(-60, 60)), 1) for _ in range(60)]
    m = framing.run(media.decode(write_clip(tmp_path / "s.mp4", shaky, fps=30))).measurements
    assert m["unstable_ratio"] > 0.5
    blank = [np.full_like(base, 90) for _ in range(30)]
    m = framing.run(media.decode(write_clip(tmp_path / "b.mp4", blank, fps=15))).measurements
    assert m["off_target_ratio"] == 1.0
    dim_textured = [(f * 0.35).astype(np.uint8) for f in scene(7, 30, size=(320, 180))]
    m = framing.run(media.decode(write_clip(tmp_path / "d.mp4", dim_textured, fps=15))).measurements
    assert m["off_target_ratio"] == 0.0  # dim footage with structure is not "off target"


# --- 4. duplicates ----------------------------------------------------------------------


def _store_with(tmp_path, frames, fps=30):
    s = orig.InMemoryFingerprintStore()
    ref = write_clip(tmp_path / "ref.mp4", frames, fps=fps)
    out, prints = orig.run(media.decode(ref), "o", s, "ref")
    assert out.measurements["max_similarity"] == 0.0
    s.add("o", "ref", prints)
    return s


def _similarity(tmp_path, store, frames, name, fps=30):
    out, _ = orig.run(media.decode(write_clip(tmp_path / f"{name}.mp4", frames, fps=fps)),
                      "o", store, name)
    return out.measurements


@pytest.fixture(scope="module")
def src_frames():
    return scene(21, 240, size=(320, 180))


@pytest.mark.parametrize("variant", ["mirror", "speed", "trim", "crop", "reencode"])
def test_duplicate_variants_match_original(tmp_path, src_frames, variant):
    store = _store_with(tmp_path, src_frames)
    if variant == "mirror":
        frames = [f[:, ::-1].copy() for f in src_frames]
    elif variant == "speed":  # the eval's 1.25x
        idx = np.linspace(0, len(src_frames) - 1, int(len(src_frames) / 1.25)).round().astype(int)
        frames = [src_frames[i] for i in idx]
    elif variant == "trim":  # 10 % off both ends, an offset that is not on any sampling grid
        frames = src_frames[23:-19]
    elif variant == "crop":  # the eval's 8 % border, scaled back
        h, w = src_frames[0].shape[:2]
        dy, dx = int(h * 0.08), int(w * 0.08)
        frames = [cv2.resize(f[dy:h - dy, dx:w - dx], (w, h)) for f in src_frames]
    else:
        frames = [cv2.resize(cv2.resize(f, (240, 135)), (320, 180)) for f in src_frames]
    m = _similarity(tmp_path, store, frames, variant)
    assert m["max_similarity"] >= 0.9 and m["match_video_id"] == "ref"


def test_unrelated_and_dark_clips_do_not_match(tmp_path, src_frames):
    store = _store_with(tmp_path, src_frames)
    assert _similarity(tmp_path, store, scene(99, 120, size=(320, 180)), "other"
                       )["max_similarity"] < 0.2
    # two different dark clips must not look alike: flat frames carry no evidence
    dark_a = [(f * 0.05).astype(np.uint8) for f in scene(31, 60, size=(320, 180))]
    dark_b = [(f * 0.05).astype(np.uint8) for f in scene(32, 60, size=(320, 180))]
    s2 = _store_with(tmp_path, dark_a)
    assert _similarity(tmp_path, s2, dark_b, "dark_b")["max_similarity"] == 0.0
