"""Plain-Python values for measurements: numpy scalars and arrays do not survive json.dumps."""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

import numpy as np


def to_py(value: Any) -> Any:
    """Recursively convert numpy scalars/arrays (and tuples) to JSON-serialisable Python."""
    if isinstance(value, np.generic):
        return value.item()
    if isinstance(value, np.ndarray):
        return value.tolist()
    if isinstance(value, Mapping):
        return {str(k): to_py(v) for k, v in value.items()}
    if isinstance(value, list | tuple):
        return [to_py(v) for v in value]
    return value
