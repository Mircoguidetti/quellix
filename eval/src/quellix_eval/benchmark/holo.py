"""HoloAssist slices of benchmark v2: task completion and hand visibility.

Data: the official release at hl2data.z5.web.core.windows.net (CDLA-Permissive-2.0), read
member by member with HTTP Range requests (`remote_tar`). Sessions come from the official
*validation* split. Labels come only from HoloAssist's annotations and hand tracking:

- task slice: a 60 s clip ending just after the last annotated fine-grained action
  (completed) and a 60 s clip ending halfway through that action (not completed). Sessions with
  an uncorrected wrong action get no "completed" clip (the task may have been done wrong).
- hands slice: a 20 s window at a random position with enough annotated actions; label from the
  projected hand joints (`handpose`), "manipulation" = inside a fine-grained action.
"""

from __future__ import annotations

import io
import json
import random
import re
import zipfile
from collections import defaultdict
from collections.abc import Callable, Iterable, Mapping, Sequence
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import httpx

from ..datasets.manifest import ClipRecord, TaskSpec
from . import handpose
from .media import cut
from .remote_tar import Member, RangeReader, load_or_walk

BASE = "https://hl2data.z5.web.core.windows.net/holoassist-data-release"
ANNOTATIONS_URL = f"{BASE}/data-annotation-trainval-v1_1.json"
VIDEO_TAR_URL = f"{BASE}/video_pitch_shifted.tar"     # full resolution (896 px); compressed is 256
HANDS_TAR_URL = f"{BASE}/hands.tar"
CAM_TAR_URL = f"{BASE}/cam_info.tar"
SPLITS_URL = ("https://raw.githubusercontent.com/holoassist/holoassist.github.io/"
              "8e2f38a8a7f5846fb31ceee17be2e9186ee62cfb/label_files/data-splits-v1_2.zip")
LICENSE = "cdla-permissive-2.0"
SOURCE = "holoassist"

TASK_CLIP_S = 60.0
HANDS_CLIP_S = 20.0
AFTER_LAST_ACTION_S = 2.0
MIN_ACTION_SHARE = 0.5        # a hands window must be at least half manipulation

# The 20 HoloAssist tasks, keyed by the token in the session name.
TASKS: dict[str, str] = {
    "gopro": "Change the battery of a GoPro camera",
    "dslr": "Set up and use a DSLR camera",
    "nespresso": "Make a coffee with a Nespresso machine",
    "espresso": "Make a coffee with an espresso machine",
    "printer_big": "Operate a big office printer (load paper, replace a cartridge)",
    "printer_small": "Operate a small printer (load paper, replace a cartridge)",
    "switch": "Set up a Nintendo Switch console",
    "navvis": "Set up a NavVis laser scanner",
    "marius_assemble": "Assemble a MARIUS stool (IKEA)",
    "marius_disassemble": "Disassemble a MARIUS stool (IKEA)",
    "gladom_assemble": "Assemble a GLADOM tray table (IKEA)",
    "gladom_disassemble": "Disassemble a GLADOM tray table (IKEA)",
    "knarrevik_assemble": "Assemble a KNARREVIK nightstand (IKEA)",
    "knarrevik_disassemble": "Disassemble a KNARREVIK nightstand (IKEA)",
    "rashult_assemble": "Assemble a RÅSHULT stool (IKEA)",
    "rashult_disassemble": "Disassemble a RÅSHULT stool (IKEA)",
    "computer": "Set up a computer",
    "coffee": "Make a coffee",
    "atv": "Assemble a toy ATV",
    "belt": "Assemble a belt",
}


def task_key(session: str) -> str:
    low = session.lower().replace("-", "_")
    low = low.replace("bigprinter", "printer_big").replace("smallprinter", "printer_small")
    for key in sorted(TASKS, key=len, reverse=True):      # longest first: "nespresso" > "espresso"
        if key in low:
            return key
    return "other"


# --- annotations -------------------------------------------------------------------------


def load_annotations(raw: Any) -> dict[str, list[dict[str, Any]]]:
    """Tolerates the two shapes seen in the wild: a list of {video_name, events} or a mapping
    from video name to {events} / a list of events."""
    out: dict[str, list[dict[str, Any]]] = {}
    if isinstance(raw, Mapping):
        items: Iterable[tuple[str, Any]] = raw.items()
    else:
        items = ((s.get("video_name") or s.get("name"), s) for s in raw)
    for name, val in items:
        events = val.get("events", []) if isinstance(val, Mapping) else val
        if name and isinstance(events, list):
            out[str(name)] = events
    return out


def fine_actions(events: Sequence[Mapping[str, Any]]) -> list[tuple[float, float]]:
    acts = [(float(e["start"]), float(e["end"])) for e in events
            if e.get("label") == "Fine grained action" and float(e["end"]) > float(e["start"])]
    return sorted(acts, key=lambda a: a[1])


def has_uncorrected_mistake(events: Sequence[Mapping[str, Any]]) -> bool:
    for e in events:
        c = str(e.get("attributes", {}).get("Action Correctness", "")).lower()
        if "wrong" in c and "not corrected" in c:
            return True
    return False


def task_spec(session: str, events: Sequence[Mapping[str, Any]]) -> TaskSpec:
    coarse = sorted((e for e in events if e.get("label") == "Coarse grained action"),
                    key=lambda e: float(e["start"]))
    steps: list[str] = []
    for e in coarse:
        s = str(e.get("attributes", {}).get("Action sentence", "")).strip()
        if s and s not in steps:
            steps.append(s)
    return TaskSpec(description=TASKS.get(task_key(session), "HoloAssist task"),
                    steps=steps[:20], final_state="the task is finished")


def load_splits(data: bytes) -> dict[str, list[str]]:
    with zipfile.ZipFile(io.BytesIO(data)) as z:
        out = {}
        for name in z.namelist():
            split = name.split("-", 1)[0]
            out[split] = [ln.strip() for ln in z.read(name).decode().splitlines() if ln.strip()]
    return out


def pick_sessions(candidates: Sequence[str], n: int, seed: int) -> list[str]:
    """Up to n sessions, round-robin over tasks so every task is represented."""
    by_task: dict[str, list[str]] = defaultdict(list)
    for s in sorted(candidates):
        by_task[task_key(s)].append(s)
    rng = random.Random(seed)
    for v in by_task.values():
        rng.shuffle(v)
    out: list[str] = []
    while len(out) < n and any(by_task.values()):
        for key in sorted(by_task):
            if by_task[key] and len(out) < n:
                out.append(by_task[key].pop())
    return out


# --- remote members ----------------------------------------------------------------------


def member_for(index: Mapping[str, Member], session: str, suffix: str) -> Member | None:
    """The member of `session` whose path ends with `suffix` (e.g. 'Video_pitchshift.mp4')."""
    pat = re.compile(rf"(^|/){re.escape(session)}/.*{re.escape(suffix)}$")
    hits = [m for name, m in index.items() if pat.search(name)]
    return min(hits, key=lambda m: len(m.name)) if hits else None


@dataclass
class Remote:
    """The HoloAssist release, read lazily. Indexes are cached in `cache_dir`."""

    cache_dir: Path
    client: httpx.Client | None = None
    video_url: str = VIDEO_TAR_URL
    hands_url: str = HANDS_TAR_URL
    cam_url: str = CAM_TAR_URL
    _loaded: dict[str, tuple[RangeReader, dict[str, Member]]] = field(default_factory=dict)

    def _index(self, url: str, keep: Callable[[str], bool]) -> tuple[RangeReader,
                                                                       dict[str, Member]]:
        if url not in self._loaded:
            reader = RangeReader(url, self.client)
            name = re.sub(r"\W+", "_", url.rsplit("/", 1)[-1])
            index = load_or_walk(reader, self.cache_dir / f"index_{name}.json", keep)
            self._loaded[url] = (reader, index)
        return self._loaded[url]

    def videos(self) -> tuple[RangeReader, dict[str, Member]]:
        return self._index(self.video_url, lambda n: n.endswith(".mp4"))

    def hands(self) -> tuple[RangeReader, dict[str, Member]]:
        return self._index(self.hands_url, lambda n: n.endswith("_sync.txt"))

    def cams(self) -> tuple[RangeReader, dict[str, Member]]:
        return self._index(self.cam_url, lambda n: "/Video/" in n and n.endswith(".txt"))


def _text(reader: RangeReader, m: Member) -> str:
    return reader.read(m.offset, m.size).decode("utf-8", "replace")


# --- slices ------------------------------------------------------------------------------


def task_clips(session: str, events: Sequence[Mapping[str, Any]], video: Path, out_dir: Path,
               cutter: Callable[[Path, Path, float, float], float] = cut) -> list[ClipRecord]:
    acts = fine_actions(events)
    if not acts:
        return []
    spec = task_spec(session, events)
    last_start, last_end = acts[-1]
    recs: list[ClipRecord] = []
    common = {"source": SOURCE, "license": LICENSE, "task": spec, "labels_source": "human"}
    if not has_uncorrected_mistake(events):
        end = last_end + AFTER_LAST_ACTION_S
        start = max(0.0, end - TASK_CLIP_S)
        dst = out_dir / f"holo_task_{session}_full.mp4"
        dur = cutter(video, dst, start, end)
        recs.append(ClipRecord(
            clip_id=f"holo_task_{session}_full", path=str(dst), truth="accept",
            checks={"task_completed": "pass"}, duration_s=dur,
            notes=f"HoloAssist {session} [{start:.1f}, {end:.1f}] s: ends after the last "
                  "annotated action", **common))
    cut_at = last_start + 0.5 * (last_end - last_start)
    start = max(0.0, cut_at - TASK_CLIP_S)
    dst = out_dir / f"holo_task_{session}_cut.mp4"
    dur = cutter(video, dst, start, cut_at)
    recs.append(ClipRecord(
        clip_id=f"holo_task_{session}_cut", path=str(dst), truth="reject",
        checks={"task_completed": "fail"}, duration_s=dur,
        notes=f"HoloAssist {session} [{start:.1f}, {cut_at:.1f}] s: ends halfway through the "
              "last annotated action", **common))
    return recs


def hands_window(acts: Sequence[tuple[float, float]], rng: random.Random,
                 clip_s: float = HANDS_CLIP_S) -> tuple[float, float] | None:
    """A random window (not chosen by label) that is at least MIN_ACTION_SHARE manipulation."""
    if not acts:
        return None
    end_all = max(b for _, b in acts)
    starts = [s for s in (i * 2.0 for i in range(int(end_all // 2) + 1))]
    rng.shuffle(starts)
    for s in starts:
        covered = sum(max(0.0, min(b, s + clip_s) - max(a, s)) for a, b in acts)
        if covered >= MIN_ACTION_SHARE * clip_s:
            return s, s + clip_s
    return None


def hands_clip(session: str, events: Sequence[Mapping[str, Any]], video: Path,
               vis: handpose.FrameVisibility, out_dir: Path, rng: random.Random,
               cutter: Callable[[Path, Path, float, float], float] = cut) -> ClipRecord | None:
    acts = fine_actions(events)
    win = hands_window(acts, rng)
    if win is None:
        return None
    start, end = win
    ratio, n = handpose.both_ratio(vis, start, end, acts)
    label = handpose.label_from_ratio(ratio)
    dst = out_dir / f"holo_hands_{session}.mp4"
    dur = cutter(video, dst, start, end)
    truth = "reject" if label == "fail" else "accept"
    return ClipRecord(
        clip_id=f"holo_hands_{session}", source=SOURCE, license=LICENSE, path=str(dst),
        task=task_spec(session, events), truth=truth,
        checks={"hands_visible": label}, labels_source="human", duration_s=dur,
        notes=json.dumps({"session": session, "window_s": [start, end],
                          "both_visible_ratio": ratio, "manipulation_frames": n}))


def session_visibility(remote: Remote, session: str) -> handpose.FrameVisibility | None:
    hreader, hidx = remote.hands()
    creader, cidx = remote.cams()
    need = {
        "left": (hreader, member_for(hidx, session, "Hands/Left_sync.txt")),
        "right": (hreader, member_for(hidx, session, "Hands/Right_sync.txt")),
        "pose": (creader, member_for(cidx, session, "Video/Pose_sync.txt")),
        "intr": (creader, member_for(cidx, session, "Video/Intrinsics.txt")
                 or member_for(cidx, session, "Video/Instrinsincs.txt")
                 or member_for(cidx, session, "Video/Instrinsics.txt")),
        "timing": (creader, member_for(cidx, session, "Video/VideoMp4Timing.txt")),
    }
    if any(m is None for _, m in need.values()):
        return None
    txt = {k: _text(r, m) for k, (r, m) in need.items() if m is not None}
    ts, poses = handpose.parse_pose_sync(txt["pose"])
    k, w, h = handpose.parse_intrinsics(txt["intr"])
    return handpose.visibility(handpose.parse_hand(txt["left"]), handpose.parse_hand(txt["right"]),
                               ts, poses, k, w, h, handpose.parse_mp4_start(txt["timing"]))


def overlay(video: Path, vis: handpose.FrameVisibility, t_s: float, dst: Path, title: str) -> bool:
    """Save the frame nearest `t_s` with the projected joints drawn on it (green = hand fully
    inside the frame, red = not), so a person can check the hand labels by eye."""
    import av
    import cv2
    import numpy as np

    if vis.points_left is None or vis.points_right is None or vis.size is None:
        return False
    i = int(np.argmin(np.abs(vis.t_s - t_s)))
    with av.open(str(video)) as c:
        stream = c.streams.video[0]
        c.seek(int(max(0.0, vis.t_s[i] - 1) / stream.time_base), stream=stream, backward=True)
        img = None
        for frame in c.decode(stream):
            if frame.pts is not None and float(frame.pts * stream.time_base) >= vis.t_s[i]:
                img = frame.to_ndarray(format="bgr24")
                break
    if img is None:
        return False
    sx, sy = img.shape[1] / vis.size[0], img.shape[0] / vis.size[1]
    for pts, ok in ((vis.points_left[i], vis.left[i]), (vis.points_right[i], vis.right[i])):
        color = (0, 200, 0) if ok else (0, 0, 255)
        for x, y in pts:
            if np.isfinite(x) and np.isfinite(y):
                cv2.circle(img, (int(x * sx), int(y * sy)), 4, color, -1)
    cv2.putText(img, title, (8, 24), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255, 255, 255), 2)
    dst.parent.mkdir(parents=True, exist_ok=True)
    return bool(cv2.imwrite(str(dst), img))
