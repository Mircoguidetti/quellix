from __future__ import annotations

import pytest

from .mock_api import MockApi


@pytest.fixture
def api() -> MockApi:
    return MockApi()
