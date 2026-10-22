"""Expand clean clips of a manifest into labelled defect variants (new manifest)."""

from __future__ import annotations

from collections.abc import Sequence
from pathlib import Path

from ..datasets.manifest import ClipRecord
from .generate import HAND_VARIANTS, VARIANTS, apply_variant, read_video, write_video


def build_variants(
    clean: Sequence[ClipRecord], out_dir: Path, variants: Sequence[str] | None = None
) -> list[ClipRecord]:
    """Return the clean records (unchanged) plus one record per (clip, variant)."""
    out: list[ClipRecord] = list(clean)
    for rec in clean:
        if rec.truth != "accept":
            continue
        clip = read_video(rec.path)
        for name in variants or list(VARIANTS):
            # A hands defect is only a trustworthy label if the source clip is known to show
            # both hands fully visible.
            if name in HAND_VARIANTS and rec.checks.get("hands_visible") != "pass":
                continue
            vclip, v = apply_variant(name, clip)
            dst = out_dir / f"{rec.clip_id}__{name}.mp4"
            write_video(dst, vclip.frames, vclip.fps)
            out.append(rec.model_copy(update={
                "clip_id": f"{rec.clip_id}__{name}",
                "source": "synthetic",
                "license": "synthetic",
                "path": str(dst),
                "truth": v.truth,
                "labels_source": "synthetic",
                "checks": {**rec.checks, **v.checks},
                "duration_s": len(vclip.frames) / vclip.fps,
                "notes": f"derived from {rec.clip_id}: {v.why}",
            }))
    return out
