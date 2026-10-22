from quellix_hands.aggregate import aggregate
from quellix_hands.types import FrameHands, HandObservation


def _f(t, left, right, contact="none"):
    return FrameHands(t, HandObservation("left", left, 0.9), HandObservation("right", right, 0.9),
                      {"left": contact, "right": contact})


def test_ratios_whole_and_manipulation():
    frames = [
        _f(0.0, "full", "full"),
        _f(1.0, "full", "truncated", "object"),
        _f(2.0, "full", "full", "object"),
        _f(3.0, "absent", "absent", "object"),
        _f(4.0, "truncated", "absent"),
    ]
    m = aggregate(frames, [[1.0, 3.0]])
    assert m["ratio_both_whole"] == 0.4
    assert m["ratio_any_whole"] == 0.6
    assert m["ratio_both_manipulation"] == round(1 / 3, 4)
    assert m["ratio_any_manipulation"] == round(2 / 3, 4)
    assert m["manipulation_segments"] == [[1.0, 3.0]]
    assert m["manipulation_detected"] is True
    assert m["n_frames"] == 5 and m["n_frames_manipulation"] == 3
    assert m["ratio_right_truncated_whole"] == 0.2
    assert m["contact_left"] == {"none": 2, "object": 3}
    assert "note" not in m


def test_no_manipulation_gives_null_and_says_so():
    m = aggregate([_f(t, "full", "full") for t in range(6)], [])
    assert m["ratio_both_manipulation"] is None
    assert m["ratio_any_manipulation"] is None
    assert m["ratio_both_whole"] == 1.0
    assert m["manipulation_detected"] is False
    assert "No manipulation" in m["note"]


def test_short_and_empty_clips():
    m = aggregate([_f(0.0, "full", "full", "object"), _f(0.25, "full", "full", "object")],
                  [[0.0, 0.25]])
    assert m["low_frame_count"] is True and "unreliable" in m["note"]
    assert m["ratio_both_manipulation"] == 1.0

    m = aggregate([], [])
    assert m["ratio_both_whole"] is None and m["n_frames"] == 0
    assert m["note"] == "No frames were analysed."
