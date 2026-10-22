from synthetic import ColorBlobDetector, draw_frame, hand_keypoints

from quellix_hands.infer import InferConfig, assign_sides, infer_frame
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
