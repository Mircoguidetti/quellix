"""Hand-visibility labels from HoloAssist's own hand tracking (not from any video model).

The HoloLens 2 tracks 26 joints per hand with its depth cameras, whose field of view is wider
than the RGB camera's, so a hand can be tracked while it is outside the video frame. Projecting
the joints into the RGB frame with the released camera pose and intrinsics tells, frame by
frame, whether each hand is fully inside the picture: that is our definition of "visible"
(wrist to fingertips, not cut by the frame edge).

File formats and the projection follow the dataset authors' PyHoloAssist
(github.com/taeinkwon/PyHoloAssist, MIT): tab-separated text, timestamps in 100 ns ticks,
4x4 row-major poses, `axis_transform` from the HoloLens to the OpenCV camera convention.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass

import numpy as np

JOINTS = 26
TICKS_PER_S = 10_000_000
AXIS_TRANSFORM = np.linalg.inv(
    np.array([[0, 0, 1, 0], [-1, 0, 0, 0], [0, -1, 0, 0], [0, 0, 0, 1]], dtype=float))


def _rows(text: str) -> list[list[float]]:
    return [list(map(float, line.split("\t"))) for line in text.splitlines() if line.strip()]


@dataclass(frozen=True)
class HandTrack:
    """Per synced RGB frame: joint positions (3, 26) in world space, and whether they are valid.
    The joint block is the 26 4x4 matrices right before the 52 trailing flags (26 valid,
    26 tracked); parsing from the end does not depend on how many header columns precede it."""

    joints: np.ndarray       # (frames, 3, 26)
    valid: np.ndarray        # (frames,) bool: every joint valid and finite


def parse_hand(text: str) -> HandTrack:
    joints, valid = [], []
    for row in _rows(text):
        mats = np.array(row[-52 - JOINTS * 16:-52]).reshape(JOINTS, 4, 4)
        xyz = mats[:, :3, 3].T                               # translation of each joint
        flags = np.array(row[-52:-26])
        ok = bool(np.all(flags > 0.5) and np.all(np.isfinite(xyz)) and np.any(xyz != 0))
        joints.append(xyz)
        valid.append(ok)
    return HandTrack(np.array(joints).reshape(-1, 3, JOINTS), np.array(valid, dtype=bool))


def parse_pose_sync(text: str) -> tuple[np.ndarray, np.ndarray]:
    """Video/Pose_sync.txt -> (timestamps in ticks (frames,), camera poses (frames, 4, 4))."""
    rows = _rows(text)
    ts = np.array([int(r[1]) for r in rows], dtype=np.int64)
    poses = np.array([r[2:18] for r in rows]).reshape(-1, 4, 4)
    return ts, poses


def parse_intrinsics(text: str) -> tuple[np.ndarray, int, int]:
    data = list(map(float, text.split()))
    return np.array(data[:9]).reshape(3, 3), int(data[-2]), int(data[-1])


def parse_mp4_start(text: str) -> int:
    """Video/VideoMp4Timing.txt: first line = tick of the mp4's first frame."""
    return int(text.split()[0])


def project(points_world: np.ndarray, cam_pose: np.ndarray, k: np.ndarray) -> np.ndarray:
    """(3, n) world points -> (n, 3): pixel x, pixel y, depth (camera z; > 0 = in front)."""
    homo = np.vstack([points_world, np.ones((1, points_world.shape[1]))])
    cam = AXIS_TRANSFORM @ np.linalg.inv(cam_pose) @ homo
    z = cam[2]
    with np.errstate(divide="ignore", invalid="ignore"):
        uv = (k @ cam[:3]) / z
    return np.vstack([uv[0], uv[1], z]).T


def fully_visible(points_world: np.ndarray, cam_pose: np.ndarray, k: np.ndarray, width: int,
                  height: int, margin_px: float = 0.0) -> bool:
    p = project(points_world, cam_pose, k)
    return bool(np.all(p[:, 2] > 0.05)
                and np.all((p[:, 0] >= margin_px) & (p[:, 0] <= width - margin_px))
                and np.all((p[:, 1] >= margin_px) & (p[:, 1] <= height - margin_px)))


@dataclass(frozen=True)
class FrameVisibility:
    t_s: np.ndarray          # seconds from the start of the mp4
    left: np.ndarray         # bool per frame: left hand fully in frame
    right: np.ndarray


def visibility(left: HandTrack, right: HandTrack, ts: np.ndarray, poses: np.ndarray,
               k: np.ndarray, width: int, height: int, mp4_start: int) -> FrameVisibility:
    n = min(len(ts), len(left.valid), len(right.valid), len(poses))
    vis = {}
    for side, track in (("left", left), ("right", right)):
        vis[side] = np.array([
            bool(track.valid[i]) and fully_visible(track.joints[i], poses[i], k, width, height)
            for i in range(n)])
    t_s = (ts[:n] - mp4_start) / TICKS_PER_S
    return FrameVisibility(t_s, vis["left"], vis["right"])


def both_ratio(v: FrameVisibility, start_s: float, end_s: float,
               actions: Sequence[tuple[float, float]]) -> tuple[float | None, int]:
    """Share of frames in [start, end) that are inside an action ('manipulation') with both
    hands fully visible. -> (ratio or None when no action frame, number of action frames)."""
    in_window = (v.t_s >= start_s) & (v.t_s < end_s)
    in_action = np.zeros_like(in_window)
    for a, b in actions:
        in_action |= (v.t_s >= a) & (v.t_s <= b)
    sel = in_window & in_action
    n = int(sel.sum())
    return (float((v.left & v.right)[sel].mean()) if n else None), n


PASS_AT, FAIL_AT = 0.85, 0.75   # around the rubric's 0.8; between them the label is unknown


def label_from_ratio(ratio: float | None) -> str:
    if ratio is None:
        return "unknown"
    if ratio >= PASS_AT:
        return "pass"
    if ratio <= FAIL_AT:
        return "fail"
    return "unknown"
