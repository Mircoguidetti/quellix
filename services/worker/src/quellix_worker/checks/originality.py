"""Originality: has this customer already delivered (almost) this video?

Fingerprints are scoped to the customer (``org_id``); there is no cross-customer matching.
Two signals per sampled frame:

* a PDQ perceptual hash (Meta ThreatExchange, via ``pdqhash``), matched in memory per org;
* optionally an embedding (DINOv2 ViT-S/14, 384-d), matched by the ``match_fingerprints`` RPC.

The video similarity is the share of the new video's frames that have a near-duplicate in
one previously delivered video (the best such video).
"""

from __future__ import annotations

import os
import pickle
from collections.abc import Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Protocol

import cv2
import httpx
import numpy as np
import pdqhash

from ..media import DecodedVideo, Frame
from ..rubric import CheckOutput

MODEL = "originality:pdq@0.2.8"

# PDQ recommends a Hamming distance <= 31 of 256 bits as "same image".
PDQ_MAX_DISTANCE = 31
# Cosine similarity of two DINOv2 CLS embeddings above which two frames count as the same
# picture. PLACEHOLDER: calibrate on re-encodes / crops in `eval` before trusting it alone.
EMBEDDING_MIN_COSINE = 0.92
EMBEDDING_DIM = 384
PDQ_MODEL_NAME = "pdq"

# Indexed copies of each frame cropped to these shares of the centre, so a copy that was
# cropped and zoomed back still matches (PDQ alone is not robust to cropping).
CROP_SHARES = (0.9, 0.8)

_POPCOUNT = np.array([bin(i).count("1") for i in range(256)], dtype=np.uint8)


@dataclass(frozen=True)
class FrameFingerprint:
    """One stored row. PDQ rows have ``embedding=None``; embedding rows have ``pdq=None``."""

    t_s: float
    pdq: bytes | None = None  # 32 bytes = 256 bits
    embedding: np.ndarray | None = None  # float32, L2-normalised
    model: str = PDQ_MODEL_NAME


class Embedder(Protocol):
    """One L2-normalised vector per frame, or None if unavailable. ``name`` is stored as
    ``fingerprints.model``."""

    name: str

    def embed(self, frames: Sequence[Frame]) -> np.ndarray | None: ...


class NoopEmbedder:
    name = "none"

    def embed(self, frames: Sequence[Frame]) -> np.ndarray | None:
        return None


def _pack(bits: np.ndarray) -> bytes:
    return np.packbits(bits.astype(np.uint8)).tobytes()


def _pdq(rgb: np.ndarray) -> bytes:
    return _pack(pdqhash.compute(rgb)[0])


def pdq_variants(rgb: np.ndarray) -> list[bytes]:
    """Hashes searched for a new frame: the frame itself and its horizontal mirror."""
    # Hash the physically mirrored pixels: exact, unlike deriving the mirror hash from the
    # original (pdqhash.compute_dihedral is only approximate after re-encoding).
    return [_pdq(rgb), _pdq(np.ascontiguousarray(rgb[:, ::-1]))]


def _center_crop(rgb: np.ndarray, share: float) -> np.ndarray:
    h, w = rgb.shape[:2]
    dh, dw = round(h * (1 - share) / 2), round(w * (1 - share) / 2)
    return np.ascontiguousarray(rgb[dh:h - dh, dw:w - dw])


def fingerprint(
    frames: Sequence[Frame], embedder: Embedder | None = None
) -> list[FrameFingerprint]:
    """Rows to store for a video: PDQ rows (full frame + centre crops) and, when an embedder
    is configured, one embedding row per frame."""
    out = []
    for f in frames:
        out.append(FrameFingerprint(f.t_s, pdq=_pdq(f.rgb)))
        out.extend(FrameFingerprint(f.t_s, pdq=_pdq(_center_crop(f.rgb, s)))
                   for s in CROP_SHARES)
    embedder = embedder or NoopEmbedder()
    vectors = embedder.embed(frames)
    if vectors is not None:
        out.extend(FrameFingerprint(f.t_s, embedding=vectors[i], model=embedder.name)
                   for i, f in enumerate(frames))
    return out


@dataclass(frozen=True)
class EmbeddingMatch:
    video_id: str
    t_s: float
    similarity: float


class FingerprintIndex:
    """All PDQ hashes of one customer, searchable in memory."""

    def __init__(self, video_ids: Sequence[str], pdq: np.ndarray) -> None:
        self.video_ids = np.asarray(video_ids, dtype=object)
        self.pdq = np.asarray(pdq, dtype=np.uint8).reshape(-1, 32)

    def __len__(self) -> int:
        return len(self.video_ids)

    def hits(self, rgb: np.ndarray) -> set[str]:
        """Earlier videos holding a frame that matches this one (or its mirror)."""
        if len(self) == 0:
            return set()
        queries = np.stack([np.frombuffer(v, dtype=np.uint8) for v in pdq_variants(rgb)])
        # (variants, n, 32) -> Hamming distance per reference row; best variant wins.
        dist = _POPCOUNT[queries[:, None, :] ^ self.pdq[None, :, :]].sum(axis=2).min(axis=0)
        return {str(v) for v in self.video_ids[dist <= PDQ_MAX_DISTANCE]}


class FingerprintStore(Protocol):
    def index(self, org_id: str, exclude_video_id: str | None = None) -> FingerprintIndex: ...

    def match_embedding(
        self, org_id: str, embedding: np.ndarray, exclude_video_id: str | None = None,
        limit: int = 20,
    ) -> list[EmbeddingMatch]: ...

    def add(self, org_id: str, video_id: str, prints: Sequence[FrameFingerprint]) -> None: ...


def _empty_index() -> FingerprintIndex:
    return FingerprintIndex([], np.zeros((0, 32), dtype=np.uint8))


class InMemoryFingerprintStore:
    def __init__(self) -> None:
        self._rows: dict[str, list[tuple[str, FrameFingerprint]]] = {}

    def index(self, org_id: str, exclude_video_id: str | None = None) -> FingerprintIndex:
        rows = [(v, fp) for v, fp in self._rows.get(org_id, [])
                if v != exclude_video_id and fp.pdq is not None]
        if not rows:
            return _empty_index()
        return FingerprintIndex([v for v, _ in rows],
                                np.stack([np.frombuffer(fp.pdq, dtype=np.uint8)
                                          for _, fp in rows]))

    def match_embedding(self, org_id, embedding, exclude_video_id=None, limit=20):
        rows = [(v, fp) for v, fp in self._rows.get(org_id, [])
                if v != exclude_video_id and fp.embedding is not None]
        scored = sorted(((float(fp.embedding @ embedding), v, fp.t_s) for v, fp in rows),
                        reverse=True)[:limit]
        return [EmbeddingMatch(v, t, s) for s, v, t in scored]

    def add(self, org_id: str, video_id: str, prints: Sequence[FrameFingerprint]) -> None:
        self._rows.setdefault(org_id, []).extend((video_id, fp) for fp in prints)


class FileFingerprintStore(InMemoryFingerprintStore):
    """In-memory store persisted to a local pickle file.

    For local runs and `eval`, where every video is a separate CLI process: without it,
    each video would be compared against an empty index and no duplicate could be found.
    Not for production (production uses SupabaseFingerprintStore).
    """

    def __init__(self, path: str | Path) -> None:
        super().__init__()
        self._path = Path(path)
        if self._path.exists():
            with self._path.open("rb") as f:
                self._rows = pickle.load(f)  # noqa: S301 - local file written by this class

    def save(self) -> None:
        self._path.parent.mkdir(parents=True, exist_ok=True)
        tmp = self._path.with_suffix(self._path.suffix + ".tmp")
        with tmp.open("wb") as f:
            pickle.dump(self._rows, f)
        tmp.replace(self._path)


def _decode_bytea(value: str) -> bytes:
    return bytes.fromhex(value[2:]) if value.startswith("\\x") else bytes.fromhex(value)


def _vector_literal(v: np.ndarray) -> str:
    return "[" + ",".join(f"{x:.6f}" for x in v) + "]"


class SupabaseFingerprintStore:
    """``public.fingerprints`` through PostgREST, always filtered by ``org_id``.

    PDQ hashes are loaded into memory per org and matched there; embeddings are matched by
    the ``match_fingerprints`` RPC (cosine, one org only).
    """

    PAGE = 1000

    def __init__(self, url: str | None = None, service_key: str | None = None,
                 client: httpx.Client | None = None) -> None:
        url = (url or os.environ["SUPABASE_URL"]).rstrip("/")
        key = service_key or os.environ["SUPABASE_SERVICE_ROLE_KEY"]
        self._client = client or httpx.Client(timeout=30)
        self._base = url + "/rest/v1/fingerprints"
        self._rpc = url + "/rest/v1/rpc/match_fingerprints"
        self._headers = {"apikey": key, "Authorization": f"Bearer {key}"}

    def index(self, org_id: str, exclude_video_id: str | None = None) -> FingerprintIndex:
        ids: list[str] = []
        hashes: list[bytes] = []
        offset = 0
        while True:
            params = {"select": "video_id,pdq", "org_id": f"eq.{org_id}", "pdq": "not.is.null",
                      "order": "id", "limit": str(self.PAGE), "offset": str(offset)}
            resp = self._client.get(self._base, params=params, headers=self._headers)
            resp.raise_for_status()
            rows = resp.json()
            for r in rows:
                if r["video_id"] != exclude_video_id:
                    ids.append(r["video_id"])
                    hashes.append(_decode_bytea(r["pdq"]))
            if len(rows) < self.PAGE:
                break
            offset += self.PAGE
        if not ids:
            return _empty_index()
        return FingerprintIndex(ids, np.stack([np.frombuffer(h, dtype=np.uint8) for h in hashes]))

    def match_embedding(self, org_id, embedding, exclude_video_id=None, limit=20):
        body = {"p_org": org_id, "p_embedding": _vector_literal(embedding),
                "p_exclude_video": exclude_video_id or "00000000-0000-0000-0000-000000000000",
                "p_limit": limit}
        resp = self._client.post(self._rpc, json=body, headers=self._headers)
        resp.raise_for_status()
        return [EmbeddingMatch(r["video_id"], r["t_s"], r["similarity"]) for r in resp.json()]

    def add(self, org_id: str, video_id: str, prints: Sequence[FrameFingerprint]) -> None:
        if not prints:
            return
        rows = [
            {
                "video_id": video_id,
                "org_id": org_id,
                "t_s": fp.t_s,
                "pdq": None if fp.pdq is None else "\\x" + fp.pdq.hex(),
                "embedding": None if fp.embedding is None else _vector_literal(fp.embedding),
                "model": fp.model,
            }
            for fp in prints
        ]
        resp = self._client.post(self._base, json=rows, headers={
            **self._headers, "Prefer": "return=minimal"})
        resp.raise_for_status()


# --------------------------------------------------------------------------- embedder
DINOV2_REPO = "facebook/dinov2-small"  # Apache-2.0, ViT-S/14, 384-d
_IMAGENET_MEAN = np.array([0.485, 0.456, 0.406], dtype=np.float32)
_IMAGENET_STD = np.array([0.229, 0.224, 0.225], dtype=np.float32)


class DinoV2Embedder:
    """DINOv2 ViT-S/14 CLS embedding (Apache-2.0). Needs the optional ``embed`` extra
    (torch, transformers). Weights load lazily on first use from Hugging Face, or from a
    local directory in ``QUELLIX_DINOV2_PATH``. They cannot be downloaded in the CI sandbox."""

    name = "dinov2-vits14"

    def __init__(self, source: str | None = None, batch_size: int = 16) -> None:
        self._source = source or os.environ.get("QUELLIX_DINOV2_PATH") or DINOV2_REPO
        self._batch = batch_size
        self._model = None
        self._torch = None

    def _load(self) -> None:
        import torch
        from transformers import AutoModel

        self._torch = torch
        self._model = AutoModel.from_pretrained(self._source).eval()
        if torch.cuda.is_available():
            self._model = self._model.to("cuda")

    def embed(self, frames: Sequence[Frame]) -> np.ndarray | None:
        if self._model is None:
            self._load()
        torch = self._torch
        out = []
        for i in range(0, len(frames), self._batch):
            imgs = [(cv2.resize(f.rgb, (224, 224), interpolation=cv2.INTER_AREA)
                     .astype(np.float32) / 255.0 - _IMAGENET_MEAN) / _IMAGENET_STD
                    for f in frames[i:i + self._batch]]
            x = torch.from_numpy(np.stack(imgs)).permute(0, 3, 1, 2).to(self._model.device)
            with torch.no_grad():
                cls = self._model(pixel_values=x).last_hidden_state[:, 0]
            cls = torch.nn.functional.normalize(cls, dim=-1)
            out.append(cls.cpu().numpy().astype(np.float32))
        return np.concatenate(out) if out else np.zeros((0, EMBEDDING_DIM), dtype=np.float32)


def run(
    video: DecodedVideo,
    org_id: str,
    store: FingerprintStore,
    video_id: str | None = None,
    embedder: Embedder | None = None,
) -> tuple[CheckOutput, list[FrameFingerprint]]:
    """-> (output, rows of this video). The caller stores the rows after the decision."""
    if not video.frames:
        return CheckOutput(error="no frames to fingerprint"), []
    try:
        prints = fingerprint(video.frames, embedder)
        index = store.index(org_id, video_id)
        matched: dict[str, int] = {}
        emb_by_t = {fp.t_s: fp.embedding for fp in prints if fp.embedding is not None}
        for f in video.frames:
            hit = index.hits(f.rgb)
            emb = emb_by_t.get(f.t_s)
            if emb is not None:
                hit |= {m.video_id for m in store.match_embedding(org_id, emb, video_id)
                        if m.similarity >= EMBEDDING_MIN_COSINE}
            for vid in hit:
                matched[vid] = matched.get(vid, 0) + 1
    except Exception as exc:
        return CheckOutput(error=f"fingerprint store unavailable: {exc}"), []
    match_id = max(matched, key=lambda k: matched[k]) if matched else None
    similarity = matched[match_id] / len(video.frames) if match_id else 0.0
    models = MODEL if embedder is None else f"{MODEL}+{embedder.name}"
    return CheckOutput(
        measurements={"max_similarity": round(similarity, 4), "match_video_id": match_id},
        model=models,
    ), prints
