"""Where the v0 weights live. Never in git: downloaded at deploy time and sha256-checked.

    python -m quellix_hands.weights download [--dest PATH]

Path resolution: ``QUELLIX_HANDS_MODEL_PATH`` if set, else ``~/.cache/quellix/hands/<file>``.
"""

from __future__ import annotations

import argparse
import hashlib
import os
import sys
import urllib.request
from pathlib import Path

# MediaPipe Hand Landmarker, float16, version 1. Apache-2.0 (see LICENSES.md).
MEDIAPIPE_URL = (
    "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/"
    "float16/1/hand_landmarker.task"
)
MEDIAPIPE_SHA256 = "fbc2a30080c3c557093b5ddfc334698132eb341044ccee322ccf8bcf3607cde1"
MEDIAPIPE_FILE = "hand_landmarker.task"


def default_path() -> Path:
    env = os.environ.get("QUELLIX_HANDS_MODEL_PATH")
    if env:
        return Path(env)
    return Path.home() / ".cache" / "quellix" / "hands" / MEDIAPIPE_FILE


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def is_valid(path: Path) -> bool:
    return path.is_file() and sha256(path) == MEDIAPIPE_SHA256


def download(dest: Path | None = None) -> Path:
    dest = dest or default_path()
    if is_valid(dest):
        return dest
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_suffix(dest.suffix + ".part")
    urllib.request.urlretrieve(MEDIAPIPE_URL, tmp)  # noqa: S310 (fixed https URL)
    if sha256(tmp) != MEDIAPIPE_SHA256:
        tmp.unlink(missing_ok=True)
        raise RuntimeError("downloaded hand_landmarker.task has an unexpected sha256")
    tmp.replace(dest)
    return dest


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(prog="python -m quellix_hands.weights")
    sub = p.add_subparsers(dest="cmd", required=True)
    d = sub.add_parser("download")
    d.add_argument("--dest", type=Path, default=None)
    args = p.parse_args(argv)
    if args.cmd == "download":
        print(download(args.dest))
    return 0


if __name__ == "__main__":
    sys.exit(main())
