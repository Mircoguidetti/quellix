"""Frame sampling (reuses the worker's decoder) and an on-disk embedding cache for training."""

from __future__ import annotations

import hashlib
from pathlib import Path

import numpy as np
from quellix_worker import media

from .encoder import Encoder

SAMPLE_FPS = 1.0
MAX_SIDE = 384


def sample_frames(
    path: Path, sample_fps: float = SAMPLE_FPS
) -> tuple[list[np.ndarray], np.ndarray]:
    """-> (RGB frames, times in seconds). Empty when the file cannot be decoded."""
    video = media.decode(path, sample_fps=sample_fps, max_side=MAX_SIDE)
    if not video.info.decodable:
        return [], np.zeros(0)
    return [f.rgb for f in video.frames], np.array([f.t_s for f in video.frames], dtype=np.float64)


def cached_embeddings(
    path: Path, encoder: Encoder, cache_dir: Path, sample_fps: float = SAMPLE_FPS,
    key: str | None = None,
) -> tuple[np.ndarray, np.ndarray]:
    """Frame embeddings + times, cached by (key, encoder, fps).

    Without `key` the entry is keyed by (file path, size, mtime), which changes whenever a
    clip is cut again. A caller that can name its content (clip id + window) passes `key`:
    the file is then not looked at, so a rebuilt clip at another path hits the same entry.

    The cache holds embeddings only, never frames, and lives outside git (data/)."""
    if key is None:
        st = path.stat()
        key = f"{path.resolve()}|{st.st_size}|{st.st_mtime_ns}"
    digest = hashlib.sha1(f"{key}|{encoder.name}|{sample_fps}".encode()).hexdigest()
    cache = cache_dir / f"{digest}.npz"
    if cache.exists():
        data = np.load(cache)
        return data["emb"], data["t"]
    frames, times = sample_frames(path, sample_fps)
    emb = encoder.embed_images(frames) if frames else np.zeros((0, 1), np.float32)
    cache_dir.mkdir(parents=True, exist_ok=True)
    np.savez_compressed(cache, emb=emb, t=times)
    return emb, times
