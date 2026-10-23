import numpy as np
from synthetic import hand_keypoints

from quellix_hands.smooth import smooth_gaps
from quellix_hands.types import FrameHands, HandObservation, absent


def obs(side, state, x=0.3):
    kp = hand_keypoints(x, 0.5)
    return HandObservation(side, state, 0.9, kp, None)


def frames_for(left_states, right_states=None, step=0.25):
    right_states = right_states or ["full"] * len(left_states)
    out = []
    for i, (a, b) in enumerate(zip(left_states, right_states, strict=True)):
        out.append(FrameHands(
            i * step,
            absent("left") if a == "absent" else obs("left", a, 0.3 + 0.01 * i),
            absent("right") if b == "absent" else obs("right", b, 0.7)))
    return out


def test_a_short_gap_between_two_full_frames_is_filled_as_full():
    fr = frames_for(["full", "absent", "absent", "full"])        # 0.75 s span: too long
    assert [f.left.state for f in smooth_gaps(fr, 0.5)] == ["full", "absent", "absent", "full"]
    fr = frames_for(["full", "absent", "full"])                  # 0.5 s span: filled
    out = smooth_gaps(fr, 0.5)
    assert [f.left.state for f in out] == ["full", "full", "full"]
    assert out[1].left.filled and not out[0].left.filled
    assert out[1].right.state == "full" and not out[1].right.filled


def test_filled_state_is_full_only_when_both_neighbours_are_full():
    out = smooth_gaps(frames_for(["full", "absent", "truncated"]), 0.5)
    assert out[1].left.state == "truncated"
    out = smooth_gaps(frames_for(["truncated", "absent", "truncated"]), 0.5)
    assert out[1].left.state == "truncated"


def test_a_gap_at_the_start_or_end_is_not_filled():
    out = smooth_gaps(frames_for(["absent", "full", "full", "absent"]), 0.5)
    assert [f.left.state for f in out] == ["absent", "full", "full", "absent"]


def test_keypoints_are_interpolated_and_the_input_is_untouched():
    fr = frames_for(["full", "absent", "full"])
    out = smooth_gaps(fr, 0.5)
    mid = out[1].left.keypoints
    expect = (np.asarray(fr[0].left.keypoints) + np.asarray(fr[2].left.keypoints)) / 2
    assert np.allclose(mid, expect)
    assert fr[1].left.state == "absent"          # frames are frozen: a new list is returned


def test_off_when_the_gap_is_zero_and_with_too_few_frames():
    fr = frames_for(["full", "absent", "full"])
    assert smooth_gaps(fr, 0.0)[1].left.state == "absent"
    two = frames_for(["full", "absent"])
    assert smooth_gaps(two, 0.5)[1].left.state == "absent"


def test_a_model_with_smoothing_counts_a_one_frame_miss_as_visible():
    from synthetic import ScriptedDetector, hand_keypoints

    from quellix_hands.model import HandsModel
    from quellix_hands.types import RawHand

    def both():
        return [RawHand("left", 0.9, hand_keypoints(0.3, 0.5)),
                RawHand("right", 0.9, hand_keypoints(0.7, 0.5))]

    script = [both(), both(), [], both(), both(), both(), both(), both()]
    frames = [np.zeros((10, 10, 3), np.uint8)] * len(script)
    ts = [i * 0.25 for i in range(len(script))]
    new = HandsModel(detector=ScriptedDetector(script)).frames(frames, ts)
    assert all(f.left.full and f.right.full for f in new)
    old = HandsModel.v0(detector=ScriptedDetector(script)).frames(frames, ts)
    assert not (old[2].left.full or old[2].right.full)


def test_one_hand_labelled_left_then_right_does_not_become_two_hands():
    fr = []
    for i in range(7):                       # the same hand in the middle, label flipping
        side = "left" if i % 2 == 0 else "right"
        left = obs("left", "full", 0.5) if side == "left" else absent("left")
        right = obs("right", "full", 0.5) if side == "right" else absent("right")
        fr.append(FrameHands(i * 0.25, left, right))
    out = smooth_gaps(fr, 0.5)
    assert not any(f.left.present and f.right.present for f in out)
    assert not any(f.left.filled or f.right.filled for f in out)
