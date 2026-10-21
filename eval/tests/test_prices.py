import pytest

from quellix_eval.baselines.gemini import gemini_cost
from quellix_eval.baselines.twelvelabs import twelvelabs_cost
from quellix_eval.prices import price


def test_pegasus_default_is_1_75_per_hour():
    assert twelvelabs_cost(3600) == pytest.approx(1.75)


def test_env_override(monkeypatch):
    monkeypatch.setenv("QUELLIX_PRICE_GEMINI_IN_PER_M_TOKENS", "2")
    monkeypatch.setenv("QUELLIX_PRICE_GEMINI_OUT_PER_M_TOKENS", "0")
    assert gemini_cost(1_000_000, 5) == pytest.approx(2.0)
    assert price("pegasus_per_video_hour") == 1.75
