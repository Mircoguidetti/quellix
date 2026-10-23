"""Viewpoint: first-person (camera on the head or chest) or third-person (tripod, someone else
filming). Measurements only; the rubric decides (#79).

Evidence, all from what the worker already computes:
- the hands model's landmarks (shared with the hands check, so the model runs once): in
  first-person footage the hands point *up* the frame (wrist below the knuckles, the forearm
  coming in from the bottom edge); filmed from outside, they point down, across, or at the camera;
- the privacy check's confident faces: a face in view is someone being filmed;
- the camera motion between frames 0.1 s apart (reported only: see the constants);
- a person-parts segmenter (MediaPipe selfie multiclass, Apache-2.0): *hair* in view is
  someone's head, which a camera on your own head or chest never sees. It catches the
  over-the-shoulder shots whose hands point away from the camera like first-person ones.

Output: ``first_person_ratio`` (share of the frames with a hand whose hands point the
first-person way), ``viewpoint`` (``first_person`` / ``third_person`` / ``uncertain``),
``confidence`` and the evidence behind them. Too few frames with a hand -> ``uncertain``.
"""

from __future__ import annotations

import hashlib
import logging
import os
import urllib.request
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Any, Protocol

import cv2
import numpy as np

from ..jsonable import to_py
from ..media import DecodedVideo
from ..rubric import CheckOutput

MODEL = "viewpoint@0.3.0"
log = logging.getLogger(__name__)

# MediaPipe selfie multiclass segmenter (Apache-2.0), pinned by version and sha256. Classes:
# 0 background, 1 hair, 2 body skin, 3 face skin, 4 clothes, 5 others.
SEGMENTER_URL = ("https://storage.googleapis.com/mediapipe-models/image_segmenter/"
                 "selfie_multiclass_256x256/float32/1/selfie_multiclass_256x256.tflite")
SEGMENTER_SHA256 = "c6748b1253a99067ef71f7e26ca71096cd449baefa8f101900ea23016507e0e0"
SEGMENTER_FILENAME = "selfie_multiclass_256x256.tflite"
HAIR = 1

WRIST, MIDDLE_MCP = 0, 9

# --- constants, set on the dev split of eval/reports/viewpoint (features.jsonl.gz) only.
# v0.3 (#79): joint grid search on dev (65 first-person clips: Egocentric-10K, HoloAssist, the
# founder's and one Pixabay pick; 33 third-person: 3 founder Pexels + 30 Pixabay labelled by eye,
# after the coordinator's veto), with the constraint "no first-person clip called third-person",
# then fewest third-person clips called first-person, then fewest first-person clips sent to
# review; ties broken towards the middle of the plateau. What dev showed:
# - the share of hand frames pointing up separates the two well only with enough frames: under
#   MIN_HAND_FRAMES the verdict is `uncertain`. Clips sit close to the thresholds (a first-person
#   salad clip reads 0.37-0.44 between two extractions), so the band between THIRD_PERSON_MAX
#   and FIRST_PERSON_MIN is wide and `uncertain`;
# - a still camera is NOT a tripod sign: head-mounted factory clips are still 78-89% of the time
#   and stabilised first-person clips too. Stillness is reported, never used for the verdict;
# - hands pointing *down* from the top happen on a tripod facing the person AND on a head camera
#   mounted upside down (Egocentric-10K factory 19): that case is `uncertain`;
# - a face blocks a first-person verdict but never makes a third-person one on its own;
# - a head in view (hair) blocks a first-person verdict: it turns over-the-shoulder shots, whose
#   hands point away from the camera like first-person ones, into `uncertain`.
MIN_HAND_FRAMES = 10        # fewer frames with a hand: cannot tell
UP_MIN = 0.4                # a hand "points up" when wrist->knuckles is within ~66 deg of up
FIRST_PERSON_MIN = 0.7      # first_person_ratio at or above (no face, no head): first-person
THIRD_PERSON_MAX = 0.3      # at or below: third-person, unless the hands point straight down
INVERTED_UP_MAX = -0.7      # median pointing-up at or below: down from the top (ambiguous)
FACE_SHARE_MAX = 0.2        # a face in more than this share of the analysed frames
HAIR_MIN = 0.05             # hair covering at least this share of a frame: a head is in view
HEAD_SHARE_MAX = 0.2        # a head in more than this share of the analysed frames
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


def head_share(hair_per_frame: Sequence[float]) -> float | None:
    """Share of the analysed frames with a head in view (hair over HAIR_MIN of the frame)."""
    if not hair_per_frame:
        return None
    return sum(h >= HAIR_MIN for h in hair_per_frame) / len(hair_per_frame)


def measure(hands_per_frame: Sequence[Sequence[HandView]], aspect: float,
            faces: float, shifts: Sequence[float | None],
            heads: float | None = None) -> dict[str, Any]:
    """Video-level evidence and verdict from per-frame hands, face share, camera shifts and
    the share of frames with a head in view (None: segmenter not available)."""
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
        "head_share": round(heads, 3) if heads is not None else None,
    }
    m.update(verdict(m))
    return m


def verdict(m: Mapping[str, Any]) -> dict[str, Any]:
    """``viewpoint``, ``confidence`` and, when uncertain, ``uncertain_why`` (constants above)."""
    ratio = m.get("first_person_ratio")
    face = (m.get("face_share") or 0.0) > FACE_SHARE_MAX
    head = (m.get("head_share") or 0.0) > HEAD_SHARE_MAX

    def unsure(why: str) -> dict[str, Any]:
        return {"viewpoint": "uncertain", "confidence": 0.0, "uncertain_why": why}

    if ratio is None or m.get("hand_frames", 0) < MIN_HAND_FRAMES:
        return unsure("too few frames with a hand")
    if ratio >= FIRST_PERSON_MIN:
        if face:
            return unsure("hands seen first-person, but a face is in view")
        if head:
            return unsure("hands seen first-person, but a person's head is in view "
                          "(filmed over the shoulder?)")
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


class PartsSegmenter(Protocol):
    def hair_share(self, rgb: np.ndarray) -> float: ...


def segmenter_path() -> Path:
    explicit = os.environ.get("QUELLIX_SEGMENTER_PATH")
    if explicit:
        return Path(explicit)
    cache = Path(os.environ.get("QUELLIX_MODEL_DIR", Path.home() / ".cache" / "quellix"))
    target = cache / SEGMENTER_FILENAME
    if not target.exists():
        cache.mkdir(parents=True, exist_ok=True)
        tmp = target.with_suffix(".part")
        urllib.request.urlretrieve(SEGMENTER_URL, tmp)  # noqa: S310 (fixed https URL)
        digest = hashlib.sha256(tmp.read_bytes()).hexdigest()
        if digest != SEGMENTER_SHA256:
            tmp.unlink()
            raise RuntimeError(f"{SEGMENTER_FILENAME} has an unexpected sha256 ({digest})")
        tmp.rename(target)
    return target


class MediaPipeParts:  # pragma: no cover - needs mediapipe and the weights
    def __init__(self, path: Path | None = None) -> None:
        from mediapipe.tasks.python import BaseOptions, vision

        self._seg = vision.ImageSegmenter.create_from_options(vision.ImageSegmenterOptions(
            base_options=BaseOptions(model_asset_path=str(path or segmenter_path())),
            output_category_mask=True))

    def hair_share(self, rgb: np.ndarray) -> float:
        import mediapipe as mp

        image = mp.Image(image_format=mp.ImageFormat.SRGB, data=np.ascontiguousarray(rgb))
        mask = self._seg.segment(image).category_mask.numpy_view()
        return float((mask == HAIR).mean())


@lru_cache(maxsize=1)
def configured_segmenter() -> PartsSegmenter | None:
    """The segmenter if mediapipe and the weights are available, else None (the check then
    works without the head evidence and says so)."""
    if os.environ.get("QUELLIX_SEGMENTER", "").lower() == "off":
        return None
    try:
        return MediaPipeParts()
    except Exception:  # missing mediapipe / weights: degrade, never crash the job
        log.exception("person-parts segmenter unavailable; viewpoint runs without it")
        return None


def run(video: DecodedVideo, hands_per_frame: Sequence[Any] | None,
        privacy: CheckOutput | None, privacy_stride: int = 2,
        segmenter: PartsSegmenter | None = None) -> CheckOutput:
    if not video.frames:
        return CheckOutput(error="no frames to analyse", model=MODEL)
    if hands_per_frame is None:
        return CheckOutput(error="no hand landmarks (hands model not available)", model=MODEL)
    h, w = video.frames[0].rgb.shape[:2]
    faces = 0.0
    if privacy is not None and privacy.measurements is not None:
        analysed = [f.t_s for f in video.frames[::privacy_stride]]
        faces = face_share(privacy.measurements.get("faces") or [], analysed)
    seg = segmenter or configured_segmenter()
    heads = None
    if seg is not None:
        heads = head_share([seg.hair_share(f.rgb) for f in video.frames[::privacy_stride]])
    m = measure(hands_from_states(hands_per_frame), w / h, faces,
                camera_shifts(video.motion_pairs), heads)
    if seg is None:
        m["head_evidence"] = "segmenter not available"
    return CheckOutput(measurements=to_py(m), model=MODEL)
