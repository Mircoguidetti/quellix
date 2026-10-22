"""Fakes: an encoder whose image and text spaces are a few named one-hot directions.

A frame's "content" is a colour; the fake maps each colour to a direction and maps step or
final-state texts mentioning that colour to the same direction, so a frame matches a step
exactly when the step names the frame's colour. That is enough to test alignment, the head
and the CLI end to end without model weights.
"""

from __future__ import annotations

from collections.abc import Sequence

import numpy as np
import pytest

COLOURS = {"red": (220, 30, 30), "green": (30, 200, 30), "blue": (30, 30, 220),
           "yellow": (220, 220, 30), "white": (240, 240, 240), "black": (10, 10, 10)}
NAMES = list(COLOURS)
DIM = len(NAMES) + 2


def colour_frame(name: str, size: int = 32) -> np.ndarray:
    return np.full((size, size, 3), COLOURS[name], dtype=np.uint8)


def _direction(i: int, rng: np.random.Generator | None = None) -> np.ndarray:
    v = np.full(DIM, 0.05)
    v[i] = 1.0
    if rng is not None:
        v += rng.normal(0, 0.03, DIM)
    return v / np.linalg.norm(v)


class FakeEncoder:
    name = "fake"

    def __init__(self, seed: int = 0) -> None:
        self.rng = np.random.default_rng(seed)

    def embed_images(self, frames: Sequence[np.ndarray]) -> np.ndarray:
        out = []
        for f in frames:
            mean = f.reshape(-1, 3).mean(axis=0)
            dist = [np.linalg.norm(mean - np.array(c)) for c in COLOURS.values()]
            out.append(_direction(int(np.argmin(dist)), self.rng))
        return np.array(out)

    def embed_texts(self, texts: Sequence[str]) -> np.ndarray:
        out = []
        for t in texts:
            hit = [i for i, n in enumerate(NAMES) if n in t.lower()]
            out.append(_direction(hit[0]) if hit else _direction(DIM - 1))
        return np.array(out)


def frames_for(sequence: Sequence[tuple[str, int]]) -> tuple[list[np.ndarray], np.ndarray]:
    frames = [colour_frame(c) for c, n in sequence for _ in range(n)]
    return frames, np.arange(len(frames), dtype=np.float64)


@pytest.fixture
def encoder() -> FakeEncoder:
    return FakeEncoder()


# A three-step task; "black" frames are background, "white" is the final state.
TASK = {"description": "colour task", "steps": ["touch red", "touch green", "touch blue"],
        "final_state": "everything white"}
COMPLETE = [("black", 3), ("red", 4), ("black", 2), ("green", 4), ("blue", 4), ("white", 4)]
CUT = [("black", 3), ("red", 4), ("black", 2), ("green", 4), ("blue", 2)]
MISSING = [("black", 3), ("red", 4), ("black", 6), ("black", 6)]
