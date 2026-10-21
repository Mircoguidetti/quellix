"""Model prices, in one place. Metric code never hard-codes a price.

Override any value with an env var of the same name (upper case, prefix QUELLIX_PRICE_).
"""

from __future__ import annotations

import os

# TwelveLabs Pegasus: USD per hour of input video (default set by the coordinator, issue #3).
_DEFAULTS: dict[str, float] = {
    "pegasus_per_video_hour": 1.75,
    # Gemini: USD per 1M tokens. UNVERIFIED placeholders: the pricing page
    # (https://ai.google.dev/gemini-api/docs/pricing) was not reachable from the build sandbox.
    # Check it and override, or edit here, before quoting any Gemini cost.
    "gemini_in_per_m_tokens": 1.25,
    "gemini_out_per_m_tokens": 10.0,
}


def price(name: str) -> float:
    env = os.environ.get(f"QUELLIX_PRICE_{name.upper()}")
    return float(env) if env else _DEFAULTS[name]
