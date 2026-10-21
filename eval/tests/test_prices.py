from datetime import date

import pytest

from quellix_eval.baselines.twelvelabs import twelvelabs_cost
from quellix_eval.prices import gemini_cost


def test_pegasus_default_is_1_75_per_hour():
    assert twelvelabs_cost(3600) == pytest.approx(1.75)


def test_env_override(monkeypatch):
    monkeypatch.setenv("QUELLIX_PRICE_PEGASUS_PER_VIDEO_HOUR", "2")
    assert twelvelabs_cost(1800) == pytest.approx(1.0)


def test_flash_price_changes_on_2027_01_01():
    args = ("gemini-3.8-flash", 1_000_000, 1_000_000)
    assert gemini_cost(*args, on=date(2026, 12, 31)) == pytest.approx(0.75 + 3.75)
    assert gemini_cost(*args, on=date(2027, 1, 1)) == pytest.approx(1.50 + 7.50)


def test_pro_long_prompt_tier():
    short = gemini_cost("gemini-3.1-pro-preview", 200_000, 1_000_000)
    long = gemini_cost("gemini-3.1-pro-preview", 200_001, 1_000_000)
    assert short == pytest.approx(0.2 * 2.00 + 12.00)
    assert long == pytest.approx(0.200001 * 4.00 + 18.00)


def test_flash_lite_and_unknown_model():
    assert gemini_cost("gemini-3.5-flash-lite", 1_000_000, 1_000_000) == pytest.approx(2.80)
    assert gemini_cost("gemini-3.1-flash-lite", 1_000_000, 0) == pytest.approx(0.25)
    with pytest.raises(KeyError):
        gemini_cost("gemini-9", 1, 1)
