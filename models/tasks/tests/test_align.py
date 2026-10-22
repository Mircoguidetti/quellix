import numpy as np

from quellix_tasks.align import align_steps, standardise


def _evidence(t: int, spans: dict[int, tuple[int, int]], k: int) -> np.ndarray:
    z = np.full((t, k), -1.0)
    for step, (a, b) in spans.items():
        z[a:b + 1, step] = 3.0
    return z


def test_steps_found_in_order_with_background_between():
    segs = align_steps(_evidence(20, {0: (2, 5), 1: (8, 11), 2: (14, 17)}, 3))
    assert [(s.start, s.end) for s in segs] == [(2, 5), (8, 11), (14, 17)]
    assert all(s.found and s.score == 3.0 for s in segs)


def test_missing_step_is_skipped_not_forced():
    segs = align_steps(_evidence(20, {0: (2, 5), 2: (14, 17)}, 3))
    assert segs[0].found and segs[2].found
    assert not segs[1].found and segs[1].start is None


def test_out_of_order_evidence_keeps_rubric_order():
    # Step 1's evidence comes before step 0's: both cannot be used in order.
    segs = align_steps(_evidence(20, {1: (2, 5), 0: (10, 13)}, 2))
    found = [s for s in segs if s.found]
    assert len(found) == 1
    starts = [s.start for s in segs if s.found]
    assert starts == sorted(starts)


def test_adjacent_steps_without_gap():
    segs = align_steps(_evidence(12, {0: (0, 5), 1: (6, 11)}, 2))
    assert [(s.start, s.end) for s in segs] == [(0, 5), (6, 11)]


def test_no_evidence_finds_nothing_and_empty_inputs():
    assert not any(s.found for s in align_steps(np.full((10, 3), -1.0)))
    assert align_steps(np.zeros((5, 0))) == []
    assert not align_steps(np.zeros((0, 2)))[0].found


def test_standardise_removes_per_step_offset():
    sim = np.array([[0.1, 0.6], [0.1, 0.6], [0.5, 0.6], [0.1, 0.9]])
    z = standardise(sim)
    assert np.argmax(z[:, 0]) == 2 and np.argmax(z[:, 1]) == 3
    assert abs(np.median(z[:, 0])) < 1e-9
