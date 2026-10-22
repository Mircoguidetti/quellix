"""Build AI Egocentric-10K (Apache 2.0, gated on Hugging Face) -> manifest of short clips.

The dataset is WebDataset: per worker, TAR shards of up to 1 GB, each holding pairs
`factoryXXX_workerYYY_NNNNN.mp4` (H.265, 1920x1080, 30 fps, ~3 min) + `.json` metadata:

    factory_001/workers/worker_001/factory001_worker001_part00.tar

We never download whole shards. We stream the first few clips of one shard per factory
(spread across factories for diversity), and transcode each to a short, small clip
(default: first 20 s, 640 px wide, 15 fps) so the evaluation fits on a CI runner.

Run on a machine that can reach Hugging Face (accept the terms, set HF_TOKEN):

    python -m quellix_eval.datasets.egocentric10k --out data/ego10k.jsonl --clips 20

Source clips are assumed acceptable (truth=accept, an assumption, not a human label);
defects are added with `defects/`. Network access is injectable so tests stay offline.
"""

from __future__ import annotations

import argparse
import contextlib
import os
import sys
import tarfile
import tempfile
from collections.abc import Callable, Iterator, Sequence
from fractions import Fraction
from pathlib import Path
from typing import BinaryIO

import av
import cv2
import numpy as np

from .manifest import ClipRecord, TaskSpec, write_manifest

REPO_ID = "builddotai/Egocentric-10K"
LICENSE = "apache-2.0"

# (repo_id, token) -> repo-relative paths of .tar shards
ShardLister = Callable[[str, str], Sequence[str]]
# (repo_id, shard_path, token) -> readable binary stream of the shard (read sequentially)
ShardOpener = Callable[[str, str, str], BinaryIO]


def _hf_list_shards(repo_id: str, token: str) -> list[str]:  # pragma: no cover
    from huggingface_hub import HfApi

    files = HfApi(token=token).list_repo_files(repo_id, repo_type="dataset")
    return sorted(f for f in files if f.endswith(".tar"))


def _hf_open_shard(repo_id: str, shard: str, token: str) -> BinaryIO:  # pragma: no cover
    from huggingface_hub import HfFileSystem

    fs = HfFileSystem(token=token)
    return fs.open(f"datasets/{repo_id}/{shard}", "rb", block_size=8 * 1024 * 1024)


def pick_shards(shards: Sequence[str], n: int) -> list[str]:
    """One shard per factory (the first worker's first part), up to n, for diversity."""
    return shard_order(shards)[: min(n, len({s.split("/", 1)[0] for s in shards}))]


def shard_order(shards: Sequence[str]) -> list[str]:
    """Every shard, round-robin across factories: first shard of each factory, then the second
    of each, and so on. Taking a prefix is always as diverse as possible."""
    by_factory: dict[str, list[str]] = {}
    for s in sorted(shards):
        by_factory.setdefault(s.split("/", 1)[0], []).append(s)
    order: list[str] = []
    for depth in range(max((len(v) for v in by_factory.values()), default=0)):
        order += [v[depth] for v in by_factory.values() if depth < len(v)]
    return order


def iter_tar_videos(stream: BinaryIO, limit: int) -> Iterator[tuple[str, bytes]]:
    """Yield (key, mp4 bytes) for the first `limit` videos of a tar stream, reading sequentially."""
    count = 0
    with tarfile.open(fileobj=stream, mode="r|*") as tar:
        for member in tar:
            if count >= limit:
                return
            if not member.isfile() or not member.name.endswith(".mp4"):
                continue
            f = tar.extractfile(member)
            if f is None:
                continue
            yield Path(member.name).stem, f.read()
            count += 1


def transcode(
    src: Path, dst: Path, seconds: float, width: int, fps: float,
    codec: str = "mpeg4", options: dict[str, str] | None = None, start_s: float = 0.0,
) -> float:
    """Write `seconds` of src from `start_s`, resized to `width` and resampled to `fps`.

    Returns the written duration in seconds.
    """
    dst.parent.mkdir(parents=True, exist_ok=True)
    written = 0
    with av.open(str(src)) as inp, av.open(str(dst), "w") as out:
        stream = inp.streams.video[0]
        stream.thread_type = "AUTO"
        src_fps = float(stream.average_rate or 30)
        step = max(1, round(src_fps / fps))
        ostream = None
        for i, frame in enumerate(inp.decode(stream)):
            t = i / src_fps
            if t < start_s:
                continue
            if t >= start_s + seconds:
                break
            if (i - round(start_s * src_fps)) % step:
                continue
            img = frame.to_ndarray(format="rgb24")
            h, w = img.shape[:2]
            new_w = min(width, w) - min(width, w) % 2
            new_h = int(h * new_w / w) - int(h * new_w / w) % 2
            img = cv2.resize(img, (new_w, new_h), interpolation=cv2.INTER_AREA)
            if ostream is None:
                rate = Fraction(src_fps / step).limit_denominator(1000)
                ostream = out.add_stream(codec, rate=rate)
                ostream.width, ostream.height, ostream.pix_fmt = new_w, new_h, "yuv420p"
                ostream.options = options or {"qscale": "3"}
            vf = av.VideoFrame.from_ndarray(np.ascontiguousarray(img), format="rgb24")
            for p in ostream.encode(vf):
                out.mux(p)
            written += 1
        if ostream is not None:
            for p in ostream.encode():
                out.mux(p)
    if written == 0:
        raise ValueError(f"no frames decoded from {src}")
    return written / (src_fps / step)


def build(
    out: Path,
    data_dir: Path,
    clips: int = 20,
    per_shard: int = 2,
    seconds: float = 20.0,
    width: int = 640,
    fps: float = 15.0,
    token: str | None = None,
    min_factories: int = 1,
    codec: str = "mpeg4",
    options: dict[str, str] | None = None,
    lister: ShardLister = _hf_list_shards,
    opener: ShardOpener = _hf_open_shard,
) -> int:
    token = token or os.environ.get("HF_TOKEN")
    if not token:
        raise RuntimeError("HF_TOKEN is required (gated dataset)")
    order = shard_order(lister(REPO_ID, token))
    factories = len({s.split("/", 1)[0] for s in order})
    if factories < min_factories:
        raise RuntimeError(f"only {factories} factories found, need at least {min_factories}")
    # Spread over at least `min_factories` shards first; keep going through further shards
    # (more workers, more parts) until the requested number of clips is reached.
    first_pass = max(-(-clips // per_shard), min_factories)
    max_shards = max(first_pass * 4, 40)
    records: list[ClipRecord] = []
    tried = 0
    with tempfile.TemporaryDirectory() as td:
        for shard in order:
            if len(records) >= clips or tried >= max_shards:
                break
            tried += 1
            try:
                stream = opener(REPO_ID, shard, token)
            except Exception as e:  # noqa: BLE001 - one bad shard must not stop the run
                print(f"skip shard {shard}: {e}", file=sys.stderr)
                continue
            taken = 0
            try:
                for key, data in iter_tar_videos(stream, per_shard + 2):
                    if taken >= per_shard or len(records) >= clips:
                        break
                    raw = Path(td) / f"{key}.mp4"
                    raw.write_bytes(data)
                    dst = data_dir / f"{key}.mp4"
                    try:
                        duration = transcode(raw, dst, seconds, width, fps, codec, options)
                    except Exception as e:  # noqa: BLE001 - undecodable clip: try the next one
                        print(f"skip clip {key}: {e}", file=sys.stderr)
                        continue
                    finally:
                        raw.unlink(missing_ok=True)
                    taken += 1
                    records.append(ClipRecord(
                        clip_id=f"ego10k_{key}",
                        source=REPO_ID,
                        license=LICENSE,
                        path=str(dst),
                        task=TaskSpec(description="Factory work, head-mounted camera."),
                        truth="accept",
                        labels_source="baseline",
                        duration_s=duration,
                        notes=f"from {shard}; truth=accept is assumed, not human-reviewed",
                    ))
            except Exception as e:  # noqa: BLE001 - broken tar stream: keep what we have
                print(f"stream error in {shard}: {e}", file=sys.stderr)
            finally:
                with contextlib.suppress(Exception):
                    stream.close()
    if len(records) < clips:
        print(f"WARNING: wanted {clips} clips, got {len(records)} after {tried} shards",
              file=sys.stderr)
    return write_manifest(records, out)


def main(argv: list[str] | None = None) -> None:  # pragma: no cover
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--out", type=Path, default=Path("data/ego10k.jsonl"))
    ap.add_argument("--data-dir", type=Path, default=Path("data/ego10k"))
    ap.add_argument("--clips", type=int, default=20)
    ap.add_argument("--per-shard", type=int, default=2)
    ap.add_argument("--seconds", type=float, default=20.0)
    ap.add_argument("--width", type=int, default=640)
    ap.add_argument("--fps", type=float, default=15.0)
    a = ap.parse_args(argv)
    n = build(a.out, a.data_dir, a.clips, a.per_shard, a.seconds, a.width, a.fps)
    print(f"wrote {n} clips to {a.out}")


if __name__ == "__main__":  # pragma: no cover
    main()
