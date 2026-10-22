import numpy as np
import pytest
from synthetic import hand_keypoints

from quellix_hands.truncation import state_from_box, state_from_keypoints


def test_hand_in_the_middle_is_full():
    assert state_from_keypoints(hand_keypoints(0.5, 0.5)) == "full"


def test_fingertip_extrapolated_past_the_edge_is_truncated():
    kp = hand_keypoints(0.5, 0.5)
    kp[8] = [1.03, 0.4]  # index tip outside the frame (MediaPipe extrapolates)
    assert state_from_keypoints(kp) == "truncated"


def test_margin_is_configurable():
    kp = hand_keypoints(0.5, 0.5)
    kp[20] = [0.985, 0.5]  # inside the frame but 1.5% from the right edge
    assert state_from_keypoints(kp, margin=0.02) == "truncated"
    assert state_from_keypoints(kp, margin=0.01) == "full"
    assert state_from_keypoints(kp, margin=0.0) == "full"


def test_wrist_below_the_frame_is_truncated():
    assert state_from_keypoints(hand_keypoints(0.5, 0.97, size=0.2)) == "truncated"


def test_box_states():
    assert state_from_box((0.2, 0.2, 0.4, 0.5)) == "full"
    assert state_from_box((0.8, 0.2, 1.0, 0.5)) == "truncated"
    assert state_from_box((0.0, 0.2, 0.3, 0.5), margin=0.0) == "full"


def test_bad_keypoints_shape():
    with pytest.raises(ValueError):
        state_from_keypoints(np.zeros((0, 2)))
