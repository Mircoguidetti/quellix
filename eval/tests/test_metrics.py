from __future__ import annotations

import pytest

from quellix_eval.metrics import Costs, report


def test_always_accept_has_no_reject_recall_even_with_high_agreement() -> None:
    pairs = [("accept", "accept")] * 85 + [("accept", "reject")] * 15
    r = report(pairs)
    assert r.base_reject_rate == pytest.approx(0.15)
    assert r.reject_precision is None
    assert r.reject_recall == 0.0
    assert r.false_accept_rate == 1.0


def test_precision_and_recall_on_rejections() -> None:
    pairs = (
        [("reject", "reject")] * 9      # caught
        + [("reject", "accept")] * 1    # honest contributor rejected
        + [("review", "reject")] * 3    # sent to a person
        + [("accept", "reject")] * 3    # missed
        + [("accept", "accept")] * 84
    )
    r = report(pairs)
    assert r.reject_precision == pytest.approx(0.9)
    assert r.reject_recall == pytest.approx(9 / 15)
    assert r.flag_recall == pytest.approx(12 / 15)
    assert r.review_rate == pytest.approx(0.03)
    assert r.false_reject_rate == pytest.approx(1 / 85)


def test_cost_saving_against_reviewing_everything() -> None:
    costs = Costs(false_reject=2.0, false_accept=1.0, review=0.25)
    pairs = [("accept", "accept")] * 90 + [("review", "reject")] * 10
    r = report(pairs, costs)
    assert r.cost == pytest.approx(2.5)
    assert r.cost_all_human == pytest.approx(25.0)
    assert r.cost_saving == pytest.approx(0.9)


def test_empty_input_is_an_error() -> None:
    with pytest.raises(ValueError):
        report([])
