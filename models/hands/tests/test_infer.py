from synthetic import ColorBlobDetector, draw_frame, hand_keypoints

from quellix_hands.infer import InferConfig, assign_by_position, assign_sides, infer_frame
from quellix_hands.types import RawHand


def test_blob_hands_full_truncated_absent():
    det = ColorBlobDetector()
    f = infer_frame(draw_frame({"left": (0.2, 0.5, 0.4, 0.9), "right": (0.6, 0.5, 0.8, 0.9)}),
                    0.0, det)
    assert (f.left.state, f.right.state) == ("full", "full")

    # right hand pushed past the right edge of the frame
    f = infer_frame(draw_frame({"left": (0.2, 0.5, 0.4, 0.9), "right": (0.85, 0.5, 1.2, 0.9)}),
                    0.25, det)
    assert (f.left.state, f.right.state) == ("full", "truncated")
    assert f.t_s == 0.25

    f = infer_frame(draw_frame({"left": (0.2, 0.5, 0.4, 0.9)}), 0.5, det)
    assert f.right.state == "absent" and not f.right.present


def test_low_confidence_counts_as_absent():
    class Weak:
        name = "weak"

        def detect(self, rgb):
            return [RawHand("left", 0.3, hand_keypoints(0.5, 0.5))]

    f = infer_frame(draw_frame({}), 0.0, Weak(), InferConfig(min_confidence=0.5))
    assert f.left.state == "absent"


def test_two_hands_labelled_left_are_split_by_position():
    a = RawHand("left", 0.9, hand_keypoints(0.3, 0.6))
    b = RawHand("left", 0.8, hand_keypoints(0.7, 0.6))
    sides = assign_sides([a, b])
    assert sides["left"].keypoints is a.keypoints
    assert sides["right"].keypoints is b.keypoints


def test_implausible_duplicate_is_dropped():
    a = RawHand("right", 0.9, hand_keypoints(0.3, 0.6))
    b = RawHand("right", 0.8, hand_keypoints(0.7, 0.6))  # would be a "left" hand right of it
    assert set(assign_sides([a, b])) == {"right"}


def test_assignment_by_position_keeps_both_hands_whatever_the_labels_say():
    a = RawHand("right", 0.9, hand_keypoints(0.3, 0.6))
    b = RawHand("right", 0.8, hand_keypoints(0.7, 0.6))   # same label: v0 dropped one of them
    assert set(assign_sides([a, b])) == {"right"}
    sides = assign_by_position([b, a])
    assert sides["left"].keypoints is a.keypoints and sides["right"].keypoints is b.keypoints
    # labels that disagree with the positions (crossed hands) are overruled
    c = RawHand("left", 0.9, hand_keypoints(0.7, 0.6))
    d = RawHand("right", 0.9, hand_keypoints(0.3, 0.6))
    sides = assign_by_position([c, d])
    assert sides["left"].keypoints is d.keypoints
    # a single detection is labelled by where it is, not by its own label; three keep the two
    # most confident
    solo = RawHand("right", 0.7, hand_keypoints(0.2, 0.6))
    assert set(assign_by_position([solo])) == {"left"}
    assert set(assign_by_position([RawHand("left", 0.7, hand_keypoints(0.8, 0.6))])) == {"right"}
    third = RawHand("left", 0.4, hand_keypoints(0.5, 0.6))
    sides = assign_by_position([a, b, third])
    assert sides["left"].keypoints is a.keypoints and sides["right"].keypoints is b.keypoints
    assert assign_by_position([]) == {}


def test_both_hands_are_seen_when_the_detector_gives_them_the_same_label():
    class SameLabel:
        name = "same"

        def detect(self, rgb):
            return [RawHand("right", 0.9, hand_keypoints(0.3, 0.5)),
                    RawHand("right", 0.8, hand_keypoints(0.7, 0.5))]

    frame = draw_frame({})
    new = infer_frame(frame, 0.0, SameLabel())
    assert (new.left.state, new.right.state) == ("full", "full")
    old = infer_frame(frame, 0.0, SameLabel(), InferConfig.v0())
    assert old.left.state == "absent"


def test_a_wrist_at_the_frame_edge_does_not_cut_the_hand():
    kp = hand_keypoints(0.5, 0.88, size=0.2)       # wrist below the palm, at the bottom edge
    kp[0] = (0.5, 1.0)
    det = type("D", (), {"name": "d", "detect": lambda self, rgb: [RawHand("left", 0.9, kp)]})()
    frame = draw_frame({})
    assert infer_frame(frame, 0.0, det).left.state == "full"
    assert infer_frame(frame, 0.0, det, InferConfig.v0()).left.state == "truncated"
    # a fingertip past the edge is still a cut hand
    cut = kp.copy()
    cut[8] = (0.5, 1.05)
    det2 = type("D", (), {"name": "d", "detect": lambda self, rgb: [RawHand("left", 0.9, cut)]})()
    assert infer_frame(frame, 0.0, det2).left.state == "truncated"
