import json
from pathlib import Path

import av
import numpy as np
import pytest
from quellix_hands.types import FrameHands, HandObservation

from quellix_eval import site_clips as sc
from quellix_eval.defects import make_clean_clip, write_video

SKIN = np.array([224, 172, 105])


def fh(t, left="full", right="full", contact=("object", "object")):
    return FrameHands(
        t_s=t,
        left=HandObservation("left", left, 0.9, box=(0.1, 0.5, 0.3, 0.9)),
        right=HandObservation("right", right, 0.9, box=(0.6, 0.5, 0.8, 0.9)),
        contact={"left": contact[0], "right": contact[1]},
    )


def series(states, step=0.25):
    return [fh(i * step, *s) for i, s in enumerate(states)]


GOOD = ("full", "full", ("object", "none"))
BAD = ("full", "truncated", ("none", "none"))


def test_best_window_finds_the_working_stretch():
    frames = series([BAD] * 8 + [GOOD] * 40 + [BAD] * 8)          # 14 s at 4 fps, 10 s good
    w = sc.best_window(frames, window_s=9.0)
    assert w is not None and w.both_full == 1.0 and w.working == 1.0
    assert 2.0 <= w.start_s <= 3.0 and sc.window_passes(w)


def test_best_window_none_when_too_short_and_fails_when_hands_are_cut():
    assert sc.best_window(series([GOOD] * 8), window_s=9.0) is None      # 2 s of footage
    assert sc.best_window([], window_s=9.0) is None
    w = sc.best_window(series([BAD] * 40), window_s=9.0)
    assert w is not None and not sc.window_passes(w)
    w = sc.best_window(series([("full", "full", ("none", "none"))] * 40), window_s=9.0)
    assert w is not None and w.both_full == 1.0 and w.working == 0.0 and not sc.window_passes(w)


def test_frame_flags():
    assert sc.frame_flags(fh(0)) == (True, True)
    assert sc.frame_flags(fh(0, contact=("none", "none"))) == (True, False)
    assert sc.frame_flags(fh(0, right="truncated")) == (False, False)
    assert sc.frame_flags(fh(0, right="absent")) == (False, False)


def decision(faces=(), docs=(), screens=(), blur=0.0, exposure=0.0, privacy_status="pass",
             steps=None, label="accept"):
    d = {
        "decision": label, "reasons": [],
        "checks": {
            "privacy": {"status": privacy_status, "measurements": {
                "faces": list(faces), "documents": list(docs), "screens": list(screens)}},
            "technical": {"status": "pass", "measurements": {
                "decodable": True, "blur_ratio": blur, "bad_exposure_ratio": exposure}},
        },
    }
    if steps is not None:
        d["checks"]["task_completed"] = {"status": "pass", "measurements": {"steps": steps}}
    return d


def test_privacy_and_technical_gates():
    assert sc.privacy_clean(decision())
    assert not sc.privacy_clean(decision(faces=[{"t_s": 1}]))
    assert not sc.privacy_clean(decision(docs=[{"t_s": 1}]))
    assert not sc.privacy_clean(decision(screens=[{"t_s": 1}]))
    assert not sc.privacy_clean(decision(privacy_status="error"))   # not measured is not clean
    assert sc.technical_ok(decision())
    assert not sc.technical_ok(decision(blur=0.5))
    assert not sc.technical_ok(decision(exposure=0.5))


def test_light_ok():
    mid = np.full((20, 20, 3), 120, np.uint8)
    mid[:, :10] = 60
    mid[:, 10:] = 180
    assert sc.light_ok([mid])[0]
    dark = np.full((20, 20, 3), 20, np.uint8)
    assert not sc.light_ok([dark])[0]
    flat = np.full((20, 20, 3), 120, np.uint8)
    assert not sc.light_ok([flat])[0]                # no contrast
    assert not sc.light_ok([])[0]


def cand(name, factory, score=0.9, hist_seed=0, **kw):
    rng = np.random.default_rng(hist_seed)
    img = rng.integers(0, 255, (40, 40, 3), dtype=np.uint8)
    window = sc.Window(0, 9, 0.95, 0.8, score)
    c = sc.Candidate(name, Path(f"{name}.mp4"), factory, kw.get("decision", decision()),
                     window, 120.0, 40.0, sc.histogram(img))
    return c


def test_select_picks_prefers_distinct_factories_and_scores():
    cands = [cand("a1", "f1", 0.95, 1), cand("a2", "f1", 0.94, 2), cand("b1", "f2", 0.90, 3),
             cand("c1", "f3", 0.80, 4)]
    picks = sc.select_picks(cands, n=3, min_distance=0.0)
    assert [c.clip_id for c in picks] == ["a1", "b1", "c1"]            # one per factory first
    assert next(c for c in cands if c.clip_id == "a2").rejected
    # asking for more than there are factories fills up from the same factories
    assert len(sc.select_picks(cands, n=4, min_distance=0.0)) == 4


def test_select_picks_skips_similar_scenes():
    twin = cand("twin", "f2", 0.9, hist_seed=1)
    cands = [cand("a", "f1", 0.95, 1), twin, cand("c", "f3", 0.8, 9)]
    picks = sc.select_picks(cands, n=3, min_distance=0.2)
    assert "twin" not in [c.clip_id for c in picks] and "c" in [c.clip_id for c in picks]


def test_eligibility_reasons():
    ok = cand("ok", "f1")
    assert sc.eligibility(ok) is None
    assert "face" in sc.eligibility(cand("x", "f", decision=decision(faces=[{"t_s": 0}])))
    assert "blurry" in sc.eligibility(cand("x", "f", decision=decision(blur=0.9)))
    no_window = cand("x", "f")
    no_window.window = sc.Window(0, 9, 0.5, 0.2, 0.3)
    assert "hands" in sc.eligibility(no_window)
    dark = cand("x", "f")
    dark.luma = 10.0
    assert "light" in sc.eligibility(dark)
    failed = cand("x", "f")
    failed.decision = None
    assert "worker failed" in sc.eligibility(failed)


def test_hand_box_from_box_keypoints_or_none():
    assert sc.hand_box(HandObservation("left", "full", box=(0.1234, 0.2, 0.3, 0.4))) == [
        0.123, 0.2, 0.3, 0.4]
    kp = np.array([[0.2, 0.3], [0.4, 0.1], [0.3, 0.6]])
    assert sc.hand_box(HandObservation("left", "full", keypoints=kp)) == [0.2, 0.1, 0.4, 0.6]
    assert sc.hand_box(HandObservation("left", "absent")) is None


def test_steps_from_decision():
    steps = [{"name": "grab", "t_s": 1.0}]
    assert sc.steps_from(decision(steps=steps)) == steps
    assert sc.steps_from(decision()) == [] and sc.steps_from(None) == []


class FakeHands:
    """Stand-in for the hands model: finds the two skin-coloured blobs of the generated clips."""

    model_id = "hands@fake"

    def frames(self, frames, timestamps):
        out = []
        for img, t in zip(frames, timestamps, strict=True):
            mask = np.abs(img.astype(int) - SKIN).max(axis=2) < 40
            w = img.shape[1]
            sides = {}
            for name, half in (("left", mask[:, : w // 2]), ("right", mask[:, w // 2 :])):
                ys, xs = np.nonzero(half)
                if len(xs) < 20:
                    sides[name] = HandObservation(name, "absent")
                else:
                    off = 0 if name == "left" else w // 2
                    box = ((xs.min() + off) / w, ys.min() / img.shape[0],
                           (xs.max() + off) / w, ys.max() / img.shape[0])
                    sides[name] = HandObservation(name, "full", 0.9, box=box)
            out.append(FrameHands(t, sides["left"], sides["right"],
                                  {"left": "object", "right": "object"}))
        return out


def fake_worker(seen):
    def check(video, rubric):
        seen.append(video.name)
        return decision(steps=[{"name": "move", "t_s": 0.5}])

    return check


def make_source(tmp_path, name, seed):
    c = make_clean_clip(n_frames=60, size=(72, 128), fps=12.0, seed=seed)
    h, w = c.frames[0].shape[:2]
    # Per-clip background colour (so the scenes differ) and a gradient (so there is contrast);
    # the hands (skin-coloured blobs) are left untouched.
    tint = np.array([seed * 25, 0, (3 - seed) * 25], dtype=np.int16)
    ramp = np.linspace(-45, 45, w, dtype=np.int16)[None, :, None]
    frames = []
    for f in c.frames:
        skin = (np.abs(f.astype(int) - SKIN).max(axis=2) < 40)[..., None]
        shifted = np.clip(f.astype(np.int16) + tint + ramp, 0, 255).astype(np.uint8)
        frames.append(np.where(skin, f, shifted))
    p = tmp_path / f"{name}.mp4"
    write_video(p, frames, c.fps)
    return p


def test_analyse_and_produce_end_to_end(tmp_path):
    seen = []
    hands, worker = FakeHands(), fake_worker(seen)
    rubric = sc.DEFAULT_RUBRIC
    cands = [sc.analyse(f"ego10k_factory00{i}_worker001_00000", make_source(tmp_path, f"s{i}", i),
                        hands, worker, rubric, window_s=3.0) for i in (1, 2, 3)]
    face = sc.Candidate("ego10k_factory009_worker001_00000", tmp_path / "s1.mp4", "factory009",
                        decision(faces=[{"t_s": 1}]))
    cands.append(face)
    assert all(c.window is not None for c in cands[:3]) and sc.eligibility(face)

    final = tmp_path / "final"
    final.mkdir()
    (final / "clip-09.mp4").write_bytes(b"stale")
    manifest = sc.produce(cands, hands, worker, rubric, final, picks_wanted=2, width=320,
                          log=lambda s: None)
    assert [c["id"] for c in manifest["clips"]] == ["clip-01", "clip-02"]
    assert len({c["factory"] for c in manifest["clips"]}) == 2
    assert manifest["total_bytes"] < sc.TOTAL_BUDGET and manifest["license"] == "Apache-2.0"
    for c in manifest["clips"]:
        for ext in ("mp4", "webm", "jpg", "json"):
            assert (final / f"{c['id']}.{ext}").stat().st_size > 0
        with av.open(str(final / c["mp4"])) as f:                    # decodable, no audio
            assert f.streams.video[0].codec_context.width == 320 and not f.streams.audio
        with av.open(str(final / c["webm"])) as f:
            assert f.streams.video[0].codec_context.name in ("vp9", "libvpx-vp9")
        side = json.loads((final / f"{c['id']}.json").read_text())
        assert side["schema"] == sc.SCHEMA and side["hands"]["model"] == "hands@fake"
        assert side["decision"]["decision"] == "accept" and side["steps"][0]["name"] == "move"
        frames = side["hands"]["frames"]
        assert len(frames) >= 15 and frames[0]["left"]["box"] and frames[0]["right"]["state"]
        assert side["source"]["license"] == "Apache-2.0"
        assert len(side["source"]["segment_in_source_s"]) == 2
    assert not (final / "clip-09.mp4").exists()                        # stale files are removed
    # the worker judged the delivered files themselves
    assert "clip-01.mp4" in seen and "clip-02.mp4" in seen
    assert json.loads((final / "manifest.json").read_text())["clips"][0]["mp4"] == "clip-01.mp4"


def test_produce_fails_loudly_when_over_budget(tmp_path, monkeypatch):
    hands, worker = FakeHands(), fake_worker([])
    c = sc.analyse("ego10k_factory001_worker001_00000", make_source(tmp_path, "s", 1), hands,
                   worker, sc.DEFAULT_RUBRIC, window_s=3.0)
    monkeypatch.setattr(sc, "TOTAL_BUDGET", 10)
    with pytest.raises(RuntimeError, match="budget"):
        sc.produce([c], hands, worker, sc.DEFAULT_RUBRIC, tmp_path / "f", 1, width=320,
                   log=lambda s: None)


def test_candidate_report_lists_reasons(tmp_path):
    good = cand("good", "f1")
    bad = cand("bad", "f2", decision=decision(faces=[{"t_s": 0}]))
    picks = sc.select_picks([good, bad], n=1, min_distance=0.0)
    text = sc.candidate_report([good, bad], picks)
    assert "**picked**" in text and "face, document or screen" in text


def test_factory_of():
    assert sc.factory_of("ego10k_factory012_worker003_00001") == "factory012"
    assert sc.factory_of("odd") == "odd"


def test_site_rubric_is_valid_and_measures_what_we_filter_on():
    from quellix_worker.contracts import validate_rubric

    r = json.loads(sc.DEFAULT_RUBRIC.read_text())
    validate_rubric(r)
    c = r["checks"]
    assert c["privacy"]["faces"] == c["privacy"]["documents"] == c["privacy"]["screens"] == "reject"
    assert c["hands_visible"]["enabled"] and c["technical"]["enabled"]
