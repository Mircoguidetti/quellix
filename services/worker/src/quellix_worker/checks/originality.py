"""Originality: has this customer already delivered (almost) this video?

Fingerprints are scoped to the customer (``org_id``); there is no cross-customer matching.
Per sampled frame we compute a PDQ perceptual hash (Facebook ThreatExchange, via
``pdqhash``) and, when an embedder is configured, an SSCD copy-detection descriptor.
The video similarity is the share of the new video's frames that have a near-duplicate
in one previously delivered video (the best such video).
"""

from __future__ import annotations

import os
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Any, Protocol

import httpx
import numpy as np
import pdqhash

from ..media import DecodedVideo, Frame
from ..rubric import CheckOutput

MODEL = "originality:pdq@0.2.8"

# PDQ recommends a Hamming distance <= 31 of 256 bits as "same image".
PDQ_MAX_DISTANCE = 31
# SSCD descriptors are L2-normalised; cosine >= 0.75 is the published copy threshold.
SSCD_MIN_COSINE = 0.75

_POPCOUNT = np.array([bin(i).count("1") for i in range(256)], dtype=np.uint8)


@dataclass(frozen=True)
class FrameFingerprint:
    t_s: float
    pdq: bytes  # 32 bytes = 256 bits
    embedding: np.ndarray | None = None  # float32 vector, L2-normalised


class Embedder(Protocol):
    """Copy-detection embedding (SSCD). Return one vector per frame, or None if unavailable."""

    name: str

    def embed(self, frames: Sequence[Frame]) -> np.ndarray | None: ...


class NoopEmbedder:
    """Used until SSCD weights are loaded (TODO: sscd_disc_mixup.torchscript.pt, CC-BY-NC)."""

    name = "none"

    def embed(self, frames: Sequence[Frame]) -> np.ndarray | None:
        return None


def _pack(bits: np.ndarray) -> bytes:
    return np.packbits(bits.astype(np.uint8)).tobytes()


# Indexed copies of each frame cropped to these shares of the centre, so a copy that was
# cropped and zoomed back still matches (PDQ alone is not robust to cropping).
CROP_SHARES = (0.9, 0.8)


def _pdq(rgb: np.ndarray) -> bytes:
    return _pack(pdqhash.compute(rgb)[0])


def pdq_variants(rgb: np.ndarray) -> list[bytes]:
    """Hashes searched for a new frame: the frame itself and its horizontal mirror."""
    # Hash the physically mirrored pixels: cheaper to be exact than to derive the mirror
    # hash from the original (pdqhash.compute_dihedral is only approximate after re-encoding).
    return [_pdq(rgb), _pdq(np.ascontiguousarray(rgb[:, ::-1]))]


def _center_crop(rgb: np.ndarray, share: float) -> np.ndarray:
    h, w = rgb.shape[:2]
    dh, dw = round(h * (1 - share) / 2), round(w * (1 - share) / 2)
    return np.ascontiguousarray(rgb[dh:h - dh, dw:w - dw])


def fingerprint(
    frames: Sequence[Frame], embedder: Embedder | None = None
) -> list[FrameFingerprint]:
    """Index entries for a video: per frame the full hash plus the centre-crop hashes."""
    vectors = (embedder or NoopEmbedder()).embed(frames)
    out = []
    for i, f in enumerate(frames):
        emb = None if vectors is None else vectors[i]
        out.append(FrameFingerprint(f.t_s, _pdq(f.rgb), emb))
        out.extend(FrameFingerprint(f.t_s, _pdq(_center_crop(f.rgb, s)), emb) for s in CROP_SHARES)
    return out


class FingerprintIndex:
    """All fingerprints of one customer, searchable in memory."""

    def __init__(
        self,
        video_ids: Sequence[str],
        pdq: np.ndarray,
        embeddings: np.ndarray | None = None,
    ) -> None:
        self.video_ids = np.asarray(video_ids, dtype=object)
        self.pdq = np.asarray(pdq, dtype=np.uint8).reshape(-1, 32)
        self.embeddings = embeddings

    def __len__(self) -> int:
        return len(self.video_ids)

    def best_match(self, frames: Sequence[Frame], prints: Sequence[FrameFingerprint]):
        """-> (video_id, similarity) of the best matching earlier video, or (None, 0.0)."""
        if len(self) == 0 or not prints or not frames:
            return None, 0.0
        matched: dict[Any, int] = {}
        # prints holds, per frame, the full hash first and then the crop hashes: query with
        # the full hash and mirror only.
        step = 1 + len(CROP_SHARES)
        queries_fp = prints[::step]
        for f, fp in zip(frames, queries_fp, strict=True):
            queries = np.stack([np.frombuffer(v, dtype=np.uint8) for v in pdq_variants(f.rgb)])
            # (variants, n, 32) -> Hamming distance per reference row; best variant wins.
            dist = _POPCOUNT[queries[:, None, :] ^ self.pdq[None, :, :]].sum(axis=2).min(axis=0)
            hit = dist <= PDQ_MAX_DISTANCE
            if fp.embedding is not None and self.embeddings is not None:
                hit |= (self.embeddings @ fp.embedding) >= SSCD_MIN_COSINE
            for vid in set(self.video_ids[hit]):
                matched[vid] = matched.get(vid, 0) + 1
        if not matched:
            return None, 0.0
        vid = max(matched, key=lambda k: matched[k])
        return str(vid), matched[vid] / len(frames)


class FingerprintStore(Protocol):
    def index(self, org_id: str, exclude_video_id: str | None = None) -> FingerprintIndex: ...

    def add(self, org_id: str, video_id: str, prints: Sequence[FrameFingerprint]) -> None: ...


class InMemoryFingerprintStore:
    def __init__(self) -> None:
        self._rows: dict[str, list[tuple[str, FrameFingerprint]]] = {}

    def index(self, org_id: str, exclude_video_id: str | None = None) -> FingerprintIndex:
        rows = [(v, fp) for v, fp in self._rows.get(org_id, []) if v != exclude_video_id]
        if not rows:
            return FingerprintIndex([], np.zeros((0, 32), dtype=np.uint8))
        emb = None
        if all(fp.embedding is not None for _, fp in rows):
            emb = np.stack([fp.embedding for _, fp in rows])
        pdq = np.stack([np.frombuffer(fp.pdq, dtype=np.uint8) for _, fp in rows])
        return FingerprintIndex([v for v, _ in rows], pdq, emb)

    def add(self, org_id: str, video_id: str, prints: Sequence[FrameFingerprint]) -> None:
        self._rows.setdefault(org_id, []).extend((video_id, fp) for fp in prints)


def _decode_bytea(value: str) -> bytes:
    return bytes.fromhex(value[2:]) if value.startswith("\\x") else bytes.fromhex(value)


class SupabaseFingerprintStore:
    """``public.fingerprints`` through PostgREST, always filtered by ``org_id``.

    v1 loads the customer's PDQ hashes into memory and matches there. The table has no
    match RPC yet, and ``embedding`` is NOT NULL: until SSCD is wired in we store a zero
    vector (see the proposed migration in the PR report).
    """

    PAGE = 1000

    def __init__(self, url: str | None = None, service_key: str | None = None,
                 client: httpx.Client | None = None) -> None:
        url = url or os.environ["SUPABASE_URL"]
        key = service_key or os.environ["SUPABASE_SERVICE_ROLE_KEY"]
        self._client = client or httpx.Client(timeout=30)
        self._base = url.rstrip("/") + "/rest/v1/fingerprints"
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
            return FingerprintIndex([], np.zeros((0, 32), dtype=np.uint8))
        return FingerprintIndex(ids, np.stack([np.frombuffer(h, dtype=np.uint8) for h in hashes]))

    def add(self, org_id: str, video_id: str, prints: Sequence[FrameFingerprint]) -> None:
        if not prints:
            return
        zero = "[" + ",".join(["0"] * 512) + "]"
        rows = [
            {
                "video_id": video_id,
                "org_id": org_id,
                "t_s": fp.t_s,
                "embedding": "[" + ",".join(f"{x:.6f}" for x in fp.embedding) + "]"
                if fp.embedding is not None else zero,
                "pdq": "\\x" + fp.pdq.hex(),
            }
            for fp in prints
        ]
        resp = self._client.post(self._base, json=rows, headers={
            **self._headers, "Prefer": "return=minimal"})
        resp.raise_for_status()


def run(
    video: DecodedVideo,
    org_id: str,
    store: FingerprintStore,
    video_id: str | None = None,
    embedder: Embedder | None = None,
) -> tuple[CheckOutput, list[FrameFingerprint]]:
    """-> (output, fingerprints of this video). The caller stores the fingerprints."""
    if not video.frames:
        return CheckOutput(error="no frames to fingerprint"), []
    try:
        prints = fingerprint(video.frames, embedder)
        match_id, similarity = store.index(org_id, video_id).best_match(video.frames, prints)
    except Exception as exc:
        return CheckOutput(error=f"fingerprint store unavailable: {exc}"), []
    return CheckOutput(
        measurements={"max_similarity": round(similarity, 4), "match_video_id": match_id},
        model=MODEL,
    ), prints
