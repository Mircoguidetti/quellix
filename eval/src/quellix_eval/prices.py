"""Model prices, in one place. Metric code never hard-codes a price.

Sources (read 2026-10-21, standard paid tier, USD per 1M tokens):
- Gemini: https://ai.google.dev/gemini-api/docs/pricing
- TwelveLabs Pegasus: 1.75 USD per hour of input video (default set by the coordinator).

Override a flat price with env `QUELLIX_PRICE_<NAME>` (upper case).
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from datetime import date

FLAT: dict[str, float] = {
    "pegasus_per_video_hour": 1.75,
    # TODO: the pricing page does not state video tokens per second for the Gemini 3.x models.
    # Not used for cost (cost always comes from the API's usage metadata); kept for estimates.
    "gemini_video_tokens_per_s": 263.0,
}


def price(name: str) -> float:
    env = os.environ.get(f"QUELLIX_PRICE_{name.upper()}")
    return float(env) if env else FLAT[name]


@dataclass(frozen=True)
class Tier:
    """Prices valid from `since` (inclusive) until the next tier of the same model."""

    since: date
    input_per_m: float
    output_per_m: float
    # Prompts longer than this many tokens use the `long_*` prices (None = no such tier).
    long_threshold: int | None = None
    long_input_per_m: float | None = None
    long_output_per_m: float | None = None


_EPOCH = date(2000, 1, 1)

GEMINI_PRICES: dict[str, tuple[Tier, ...]] = {
    "gemini-3.8-flash": (
        Tier(_EPOCH, 0.75, 3.75),
        Tier(date(2027, 1, 1), 1.50, 7.50),
    ),
    "gemini-3.5-flash-lite": (Tier(_EPOCH, 0.30, 2.50),),
    "gemini-3.1-flash-lite": (Tier(_EPOCH, 0.25, 1.50),),
    "gemini-3.1-pro-preview": (Tier(_EPOCH, 2.00, 12.00, 200_000, 4.00, 18.00),),
}
DEFAULT_GEMINI_MODEL = "gemini-3.8-flash"


def gemini_cost(
    model: str, input_tokens: int, output_tokens: int, on: date | None = None
) -> float:
    """Cost of one call from the token counts the API returned (thinking tokens count as output).

    Raises KeyError for an unknown model rather than guessing a price.
    """
    on = on or date.today()
    tiers = [t for t in GEMINI_PRICES[model] if t.since <= on]
    tier = max(tiers, key=lambda t: t.since)
    long = tier.long_threshold is not None and input_tokens > tier.long_threshold
    in_p = tier.long_input_per_m if long else tier.input_per_m
    out_p = tier.long_output_per_m if long else tier.output_per_m
    assert in_p is not None and out_p is not None
    return (input_tokens * in_p + output_tokens * out_p) / 1_000_000
