"""Build AI Egocentric-10K (Apache 2.0, gated on Hugging Face) -> manifest.

Run on a machine with access (accept the terms on `builddotai/Egocentric-10K`, set HF_TOKEN):

    python -m quellix_eval.datasets.egocentric10k --out eval/data/ego10k.jsonl --limit 300

Clips are assumed to be good examples (truth=accept); defects are added with `defects/`.
The downloader is injectable so tests never touch the network.
"""

from __future__ import annotations

import argparse
import os
from collections.abc import Callable, Sequence
from pathlib import Path

from .manifest import ClipRecord, TaskSpec, write_manifest

REPO_ID = "builddotai/Egocentric-10K"
LICENSE = "apache-2.0"

# (repo_id, token, limit) -> list of repo-relative mp4 paths
Lister = Callable[[str, str, int], Sequence[str]]
# (repo_id, filename, token, local_dir) -> local path
Fetcher = Callable[[str, str, str, Path], Path]


def _hf_lister(repo_id: str, token: str, limit: int) -> list[str]:  # pragma: no cover
    from huggingface_hub import HfApi

    files = HfApi(token=token).list_repo_files(repo_id, repo_type="dataset")
    return sorted(f for f in files if f.endswith(".mp4"))[:limit]


def _hf_fetcher(  # pragma: no cover
    repo_id: str, filename: str, token: str, local_dir: Path
) -> Path:
    from huggingface_hub import hf_hub_download

    return Path(
        hf_hub_download(repo_id, filename, repo_type="dataset", token=token, local_dir=local_dir)
    )


def build(
    out: Path,
    data_dir: Path,
    limit: int = 300,
    token: str | None = None,
    lister: Lister = _hf_lister,
    fetcher: Fetcher = _hf_fetcher,
) -> int:
    token = token or os.environ.get("HF_TOKEN")
    if not token:
        raise RuntimeError("HF_TOKEN is required (gated dataset)")
    records = []
    for name in lister(REPO_ID, token, limit):
        local = fetcher(REPO_ID, name, token, data_dir)
        records.append(
            ClipRecord(
                clip_id="ego10k_" + Path(name).stem.replace("/", "_"),
                source="builddotai/Egocentric-10K",
                license=LICENSE,
                path=str(local),
                task=TaskSpec(description="Factory work, head-mounted camera."),
                truth="accept",
            )
        )
    return write_manifest(records, out)


def main(argv: list[str] | None = None) -> None:  # pragma: no cover
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--out", type=Path, default=Path("data/ego10k.jsonl"))
    ap.add_argument("--data-dir", type=Path, default=Path("data/ego10k"))
    ap.add_argument("--limit", type=int, default=300)
    a = ap.parse_args(argv)
    print(f"wrote {build(a.out, a.data_dir, a.limit)} clips to {a.out}")


if __name__ == "__main__":  # pragma: no cover
    main()
