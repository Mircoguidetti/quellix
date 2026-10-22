import cv2
import numpy as np
import pytest

from quellix_eval.defects import VARIANTS, apply_variant, make_clean_clip, read_video, write_video
from quellix_eval.defects import generate as g


def lap(f):
    return cv2.Laplacian(cv2.cvtColor(f, cv2.COLOR_RGB2GRAY), cv2.CV_64F).var()


def test_video_roundtrip(tmp_path):
    c = make_clean_clip(n_frames=12)
    write_video(tmp_path / "a.mp4", c.frames, c.fps)
    r = read_video(tmp_path / "a.mp4")
    assert len(r.frames) == 12 and r.frames[0].shape == c.frames[0].shape
    assert r.fps == pytest.approx(c.fps, rel=0.01)


@pytest.mark.parametrize("name", list(VARIANTS))
def test_every_variant_runs_and_is_labelled(name):
    clip = make_clean_clip(n_frames=24)
    out, v = apply_variant(name, clip)
    assert out.frames and out.frames[0].dtype == np.uint8
    assert v.truth == "reject" and v.checks
    assert all(s == ("uncertain" if name == "no_manipulation" else "fail")
               for s in v.checks.values())


def test_transforms_do_what_they_say():
    c = make_clean_clip(n_frames=24)
    assert len(g.cut_before_end(c.frames, 0.5)) == 12
    assert lap(g.motion_blur(c.frames)[0]) < lap(c.frames[0]) / 2
    assert g.exposure(c.frames, 0.12)[0].mean() < 30 < 220 < g.exposure(c.frames, 4.0)[0].mean()
    assert np.array_equal(g.mirror(c.frames)[0][:, ::-1], c.frames[0])
    assert len(g.speed_change(c.frames, 2.0)) == 12
    assert len(g.trim(c.frames, 0.25, 0.25)) == 12
    for f in (g.overlay_document, g.overlay_face, g.overlay_screen):
        assert not np.array_equal(f(c.frames)[0], c.frames[0])


def test_hands_pushed_out_of_frame():
    c = make_clean_clip(n_frames=8)
    skin = np.array([224, 172, 105])

    def hands(f):
        mask = (np.abs(f.astype(int) - skin).max(axis=2) < 30).astype(np.uint8)
        n, _, stats, _ = cv2.connectedComponentsWithStats(mask)
        return sum(1 for i in range(1, n) if stats[i, cv2.CC_STAT_AREA] > 50)

    assert hands(c.frames[0]) == 2
    assert hands(g.shift_hands_out(c.frames, "left")[0]) == 1


def test_hands_defects_only_from_clips_with_known_visible_hands(tmp_path):
    from quellix_eval.datasets.manifest import ClipRecord, TaskSpec
    from quellix_eval.defects.build import build_variants

    c = make_clean_clip(n_frames=12)
    write_video(tmp_path / "c.mp4", c.frames, c.fps)

    def rec(label):
        return ClipRecord(clip_id="c", source="synthetic", license="synthetic",
                          path=str(tmp_path / "c.mp4"), task=TaskSpec(description="d"),
                          truth="accept", checks={"hands_visible": label})

    names = ["hands_out", "blur"]
    for label, expected in (("unknown", 1), ("fail", 1), ("pass", 2)):
        out = build_variants([rec(label)], tmp_path / label, names)
        assert len(out) == 1 + expected
        assert all(r.labels_source == "synthetic" for r in out[1:])


SKIN = np.array([224, 172, 105])


def _hand_blobs(f):
    """(number of hand blobs, number of them touching the frame edge)."""
    mask = (np.abs(f.astype(int) - SKIN).max(axis=2) < 30).astype(np.uint8)
    n, _, stats, _ = cv2.connectedComponentsWithStats(mask)
    h, w = f.shape[:2]
    blobs = [stats[i] for i in range(1, n) if stats[i, cv2.CC_STAT_AREA] > 50]
    cut = sum(1 for b in blobs if b[0] == 0 or b[1] == 0 or b[0] + b[2] >= w or b[1] + b[3] >= h)
    return len(blobs), cut


@pytest.mark.parametrize("fn,inside", [
    (g.hand_out_one, (1, 0)),       # the left hand is gone, the right one fully visible
    (g.hands_out_both, (0, 0)),     # no hand at all
    (g.hand_truncated, (2, 2)),     # both hands still there, both cut by the bottom edge
])
def test_hand_defects_only_change_the_interval(fn, inside):
    c = make_clean_clip(n_frames=20)
    out = fn(c.frames)
    idx = set(g.interval_frames(20))
    assert idx == set(range(4, 16))
    for i, (a, b) in enumerate(zip(c.frames, out, strict=True)):
        assert b.shape == a.shape
        if i in idx:
            assert _hand_blobs(b) == inside, i
        else:
            assert np.array_equal(a, b) and _hand_blobs(b) == (2, 0)


def test_no_manipulation_is_a_static_scene():
    c = make_clean_clip(n_frames=10)
    out = g.no_manipulation(c.frames)
    assert len(out) == 10 and all(np.array_equal(f, c.frames[5]) for f in out)


def test_new_hand_variants_need_visible_hands_and_leave_other_checks_unknown(tmp_path):
    from quellix_eval.datasets.manifest import ClipRecord, TaskSpec
    from quellix_eval.defects.build import build_variants

    c = make_clean_clip(n_frames=12)
    write_video(tmp_path / "c.mp4", c.frames, c.fps)
    rec = ClipRecord(clip_id="c", source="synthetic", license="synthetic",
                     path=str(tmp_path / "c.mp4"), task=TaskSpec(description="d"),
                     truth="accept", checks={"hands_visible": "unknown"})
    assert len(build_variants([rec], tmp_path / "u", list(g.HAND_VARIANTS))) == 1
    ok = rec.model_copy(update={"checks": {"hands_visible": "pass", "technical": "pass"}})
    out = build_variants([ok], tmp_path / "p", ["hand_truncated", "no_manipulation"])
    assert [r.checks["hands_visible"] for r in out[1:]] == ["fail", "uncertain"]
    assert all(r.truth == "reject" for r in out[1:])
