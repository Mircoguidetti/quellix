"""Viewpoint: first-person (camera on the head or chest) or third-person (tripod, someone else
filming). Measurements only; the rubric decides (#79).

Evidence, all from what the worker already computes:
- the hands model's landmarks (shared with the hands check, so the model runs once): in
  first-person footage the hands point *up* the frame (wrist below the knuckles, the forearm
  coming in from the bottom edge); filmed from outside, they point down, across, or at the camera;
- the privacy check's confident faces: a face in view is someone being filmed;
- the camera motion between frames 0.1 s apart: a head is never perfectly still, a tripod is.

Output: ``first_person_ratio`` (share of the frames with a hand whose hands point the
first-person way), ``viewpoint`` (``first_person`` / ``third_person`` / ``uncertain``),
``confidence`` and the evidence behind them. Too few frames with a hand -> ``uncertain``.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Any

import cv2
import numpy as np

from ..jsonable import to_py
from ..media import DecodedVideo
from ..rubric import CheckOutput

MODEL = "viewpoint@0.1.0"

WRIST, MIDDLE_MCP = 0, 9

# --- constants, set on the dev split of eval/reports/viewpoint (features.jsonl.gz) only.
# Dev (63 head-mounted + 2 founder first-person Pexels clips, 3 founder third-person clips) showed:
# - first-person clips with enough hands point up in >= 72% of their hand frames (one Pexels
#   clip 44%); the third-person ones 0-70%: the ratio alone does not separate them, so the
#   region between the two thresholds is `uncertain` (review), not a guess;
# - a still camera is NOT a tripod sign: two head-mounted factory clips are still 78-89% of the
#   time and the founder's first-person Pexels clips are stabilised. Stillness is measured and
#   reported, never used for the verdict;
# - hands pointing *down* from the top of the frame happen on a tripod facing the person AND on
#   a head camera mounted upside down (Egocentric-10K factory 19): that case is `uncertain`;
# - faces: none in the third-person clips, some coworkers in the factory ones. A face blocks a
#   first-person verdict (-> uncertain) but never makes a third-person one on its own.
MIN_HAND_FRAMES = 6         # fewer frames with a hand: cannot tell
UP_MIN = 0.3                # a hand "points up" when wrist->knuckles is within ~70 deg of up
FIRST_PERSON_MIN = 0.6      # first_person_ratio at or above (and no face): first-person
THIRD_PERSON_MAX = 0.3      # at or below: third-person, unless the hands point straight down
INVERTED_UP_MAX = -0.7      # median pointing-up at or below: down from the top (ambiguous)
FACE_SHARE_MAX = 0.2        # a face in more than this share of the analysed frames
STILL_SHIFT = 0.0015        # a 0.1 s pair moving less than this share of the width is "still"


@dataclass(frozen=True)
class HandView:
    """One detected hand: its state and landmarks (index -> normalised (x, y))."""

    state: str
    kp: Mapping[int, tuple[float, float]]


def pointing_up(hand: HandView, aspect: float) -> float | None:
    """1 when the hand points straight up the frame (wrist under the knuckles), -1 straight
    down, 0 sideways; None when the landmarks are missing or degenerate."""
    if WRIST not in hand.kp or MIDDLE_MCP not in hand.kp:
        return None
    (wx, wy), (mx, my) = hand.kp[WRIST], hand.kp[MIDDLE_MCP]
    dx, dy = (mx - wx) * aspect, my - wy
    norm = float(np.hypot(dx, dy))
    if norm < 1e-3:
        return None
    return -dy / norm


def hand_scale(hand: HandView, aspect: float) -> float | None:
    """Wrist to middle knuckle, as a share of the frame height."""
    if WRIST not in hand.kp or MIDDLE_MCP not in hand.kp:
        return None
    (wx, wy), (mx, my) = hand.kp[WRIST], hand.kp[MIDDLE_MCP]
    return float(np.hypot((mx - wx) * aspect, my - wy))


def camera_shifts(pairs: Sequence[tuple[np.ndarray, np.ndarray]]) -> list[float | None]:
    """Global shift of each motion pair as a share of the frame width (None: no correlation)."""
    out: list[float | None] = []
    for a, b in pairs:
        window = cv2.createHanningWindow(a.shape[::-1], cv2.CV_32F)
        (dx, dy), resp = cv2.phaseCorrelate(a.astype(np.float32), b.astype(np.float32), window)
        out.append(float(np.hypot(dx, dy)) / a.shape[1] if resp >= 0.02 else None)
    return out


def face_share(faces: Sequence[Mapping[str, Any]], analysed_times: Sequence[float]) -> float:
    """Share of the privacy-analysed frames with a confident face."""
    if not analysed_times:
        return 0.0
    with_face = {round(float(f["t_s"]), 3) for f in faces if "t_s" in f}
    return sum(round(t, 3) in with_face for t in analysed_times) / len(analysed_times)


def measure(hands_per_frame: Sequence[Sequence[HandView]], aspect: float,
            faces: float, shifts: Sequence[float | None]) -> dict[str, Any]:
    """Video-level evidence and verdict from per-frame hands, face share and camera shifts."""
    ups, scales, votes = [], [], []
    for hands in hands_per_frame:
        frame_ups = [u for h in hands if (u := pointing_up(h, aspect)) is not None]
        scales += [s for h in hands if (s := hand_scale(h, aspect)) is not None]
        if frame_ups:
            ups += frame_ups
            votes.append(max(frame_ups) >= UP_MIN)
    measured = [s for s in shifts if s is not None]
    still = sum(s < STILL_SHIFT for s in measured) / len(measured) if measured else None
    m: dict[str, Any] = {
        "hand_frames": len(votes),
        "first_person_ratio": round(sum(votes) / len(votes), 3) if votes else None,
        "pointing_up_median": round(float(np.median(ups)), 3) if ups else None,
        "hand_scale_median": round(float(np.median(scales)), 3) if scales else None,
        "face_share": round(faces, 3),
        "still_share": round(still, 3) if still is not None else None,
    }
    m.update(verdict(m))
    return m


def verdict(m: Mapping[str, Any]) -> dict[str, Any]:
    """``viewpoint``, ``confidence`` and, when uncertain, ``uncertain_why`` (constants above)."""
    ratio = m.get("first_person_ratio")
    face = (m.get("face_share") or 0.0) > FACE_SHARE_MAX

    def unsure(why: str) -> dict[str, Any]:
        return {"viewpoint": "uncertain", "confidence": 0.0, "uncertain_why": why}

    if ratio is None or m.get("hand_frames", 0) < MIN_HAND_FRAMES:
        return unsure("too few frames with a hand")
    if ratio >= FIRST_PERSON_MIN:
        if face:
            return unsure("hands seen first-person, but a face is in view")
        return {"viewpoint": "first_person", "confidence": round(min(1.0, ratio), 2)}
    if ratio <= THIRD_PERSON_MAX:
        up = m.get("pointing_up_median")
        if up is not None and up <= INVERTED_UP_MAX:
            return unsure("hands point down from the top: a camera facing the person, or a "
                          "head camera upside down")
        return {"viewpoint": "third_person", "confidence": round(1.0 - ratio, 2)}
    return unsure("hands point up in some frames and not in others")


def hands_from_states(per_frame: Sequence[Any]) -> list[list[HandView]]:
    """quellix_hands FrameHands -> HandView lists (only hands with landmarks)."""
    out = []
    for f in per_frame:
        hands = []
        for obs in (f.left, f.right):
            if obs.state == "absent" or obs.keypoints is None:
                continue
            kp = np.asarray(obs.keypoints, dtype=float)
            hands.append(HandView(obs.state, {i: (float(kp[i, 0]), float(kp[i, 1]))
                                              for i in (WRIST, MIDDLE_MCP)}))
        out.append(hands)
    return out


def run(video: DecodedVideo, hands_per_frame: Sequence[Any] | None,
        privacy: CheckOutput | None, privacy_stride: int = 2) -> CheckOutput:
    if not video.frames:
        return CheckOutput(error="no frames to analyse", model=MODEL)
    if hands_per_frame is None:
        return CheckOutput(error="no hand landmarks (hands model not available)", model=MODEL)
    h, w = video.frames[0].rgb.shape[:2]
    faces = 0.0
    if privacy is not None and privacy.measurements is not None:
        analysed = [f.t_s for f in video.frames[::privacy_stride]]
        faces = face_share(privacy.measurements.get("faces") or [], analysed)
    m = measure(hands_from_states(hands_per_frame), w / h, faces,
                camera_shifts(video.motion_pairs))
    return CheckOutput(measurements=to_py(m), model=MODEL)
