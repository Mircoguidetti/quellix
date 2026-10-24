"""Shared image-text embedding space for frames and step descriptions.

The production encoder is SigLIP 2 base (Apache-2.0, `google/siglip2-base-patch16-224`).
It needs the optional `embed` extra (torch, transformers); weights load lazily from Hugging
Face or from a local directory in $QUELLIX_SIGLIP_PATH. Tests use a fake encoder instead.
"""

from __future__ import annotations

import os
from collections.abc import Sequence
from typing import Any, Protocol

import numpy as np

SIGLIP_REPO = "google/siglip2-base-patch16-224"  # Apache-2.0


class Encoder(Protocol):
    name: str

    def embed_images(self, frames: Sequence[np.ndarray]) -> np.ndarray:
        """uint8 RGB H x W x 3 frames -> (N, D) L2-normalised embeddings."""
        ...

    def embed_texts(self, texts: Sequence[str]) -> np.ndarray:
        """-> (N, D) L2-normalised embeddings in the same space as the images."""
        ...


def _features(out: Any) -> Any:
    """`get_*_features` returns a tensor in transformers 4 and a `BaseModelOutputWithPooling` in
    5, where `pooler_output` holds the projected embedding."""
    return out if hasattr(out, "float") else out.pooler_output


def _normalise(x: np.ndarray) -> np.ndarray:
    return x / np.maximum(np.linalg.norm(x, axis=-1, keepdims=True), 1e-12)


class SiglipEncoder:
    name = "siglip2-base-patch16-224"

    def __init__(self, source: str | None = None, batch_size: int = 16) -> None:
        self._source = source or os.environ.get("QUELLIX_SIGLIP_PATH") or SIGLIP_REPO
        self._batch = batch_size
        self._model: Any = None
        self._processor: Any = None
        self._torch: Any = None

    def _load(self) -> None:  # pragma: no cover - needs weights
        import torch
        from transformers import AutoModel, AutoProcessor

        self._torch = torch
        self._processor = AutoProcessor.from_pretrained(self._source)
        self._model = AutoModel.from_pretrained(self._source).eval()
        if torch.cuda.is_available():
            self._model = self._model.to("cuda")

    def embed_images(self, frames: Sequence[np.ndarray]) -> np.ndarray:  # pragma: no cover
        if self._model is None:
            self._load()
        out = []
        for i in range(0, len(frames), self._batch):
            inputs = self._processor(images=list(frames[i:i + self._batch]), return_tensors="pt")
            inputs = {k: v.to(self._model.device) for k, v in inputs.items()}
            with self._torch.no_grad():
                out.append(_features(self._model.get_image_features(**inputs)).float().cpu().numpy())
        return _normalise(np.concatenate(out)) if out else np.zeros((0, 768), np.float32)

    def embed_texts(self, texts: Sequence[str]) -> np.ndarray:  # pragma: no cover
        if self._model is None:
            self._load()
        # SigLIP was trained with max_length padding; other padding degrades the text tower.
        inputs = self._processor(text=list(texts), padding="max_length", max_length=64,
                                 truncation=True, return_tensors="pt")
        inputs = {k: v.to(self._model.device) for k, v in inputs.items()}
        with self._torch.no_grad():
            feats = _features(self._model.get_text_features(**inputs)).float().cpu().numpy()
        return _normalise(feats)


def step_prompt(step: str) -> str:
    return f"a first-person photo of hands: {step}"


def final_state_prompt(final_state: str) -> str:
    return f"a first-person photo of the result: {final_state}"
