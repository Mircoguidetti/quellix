from synthetic import ScriptedDetector, hand_keypoints

from quellix_hands.contact import HeuristicContact, flexion, segments_from_contact
from quellix_hands.infer import infer_frame
from quellix_hands.types import RawHand


def test_flexion_open_vs_closed():
    assert flexion(hand_keypoints(0.5, 0.5)) < 0.1
    assert flexion(hand_keypoints(0.5, 0.5, closed=True)) > 0.8


def _sequence(n=40, fps=4.0, active=range(12, 28)):
    """Hands raised and open, except frames in ``active``: low, gripping and moving."""
    script, ts = [], []
    for i in range(n):
        t = i / fps
        ts.append(t)
        if i in active:
            x = 0.4 + 0.05 * ((i % 4) - 1.5)  # moving side to side
            script.append([RawHand("left", 0.9, hand_keypoints(x, 0.75, closed=True)),
                           RawHand("right", 0.9, hand_keypoints(x + 0.2, 0.75, closed=True))])
        else:
            script.append([RawHand("left", 0.9, hand_keypoints(0.3, 0.25)),
                           RawHand("right", 0.9, hand_keypoints(0.7, 0.25))])
    det = ScriptedDetector(script)
    return [infer_frame(None, t, det) for t in ts], ts


def test_heuristic_finds_the_manipulation_interval():
    frames, ts = _sequence()
    contact = HeuristicContact().estimate(frames)
    segs = segments_from_contact(ts, contact)
    assert len(segs) == 1
    start, end = segs[0]
    # true interval is 3.0 s - 6.75 s; smoothing may shift the edges by up to half a window
    assert 2.5 <= start <= 3.75
    assert 6.0 <= end <= 7.25


def test_absent_hands_are_unknown():
    det = ScriptedDetector([[], []])
    frames = [infer_frame(None, 0.0, det), infer_frame(None, 0.25, det)]
    contact = HeuristicContact().estimate(frames)
    assert contact[0] == {"left": "unknown", "right": "unknown"}
    assert segments_from_contact([0.0, 0.25], contact) == []


def test_segments_merge_gaps_and_drop_blips():
    on, off = {"left": "object"}, {"left": "none"}
    ts = [i * 0.25 for i in range(30)]
    states = [off] * 30
    for i in list(range(2, 8)) + list(range(10, 16)) + [25]:  # gap of 0.75 s, then a blip
        states[i] = on
    assert segments_from_contact(ts, states, max_gap_s=1.0, min_segment_s=0.5) == [[0.5, 3.75]]
    assert segments_from_contact(ts, states, max_gap_s=0.5, min_segment_s=0.5) == [
        [0.5, 1.75], [2.5, 3.75]]


def test_very_short_clip_keeps_its_only_segment():
    ts = [0.0, 0.25]
    states = [{"right": "portable_object"}, {"right": "portable_object"}]
    assert segments_from_contact(ts, states, min_segment_s=0.5) == [[0.0, 0.25]]
