"""What the privacy check's face detector sees on real frames (issue #83).

    python -m quellix_eval.privacy_diagnosis --out out/privacy \\
        --report-dir reports/privacy-diagnosis

The founder's first-person landing clips show no face, yet the worker rejected the pestle clip
(6693828) for "A face is visible". This runs the worker's own decode and YuNet face detector on
the Pexels clips (landing + third-person) and records **every** raw face detection down to
RAW_MIN_SCORE, with its score, its size relative to the frame and YuNet's five landmarks, plus
what the worker made of it (confident / possible / below its floor). The frames with the
strongest detections are saved as small JPEGs with the boxes drawn and a zoom of each box, so a
person can see what is being called a face: marble veins, coffee grounds, hands, or a real face.

Writes `README.md` (images linked relatively), `comment.md` (the same with an `{IMAGE_BASE}`
placeholder for absolute links), the JPEGs and `results.json` (every raw detection, for tuning
offline). Nothing here changes a threshold.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from collections.abc import Callable, Sequence
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any

import cv2
import numpy as np
from quellix_worker import media
from quellix_worker.checks import privacy

RAW_MIN_SCORE = 0.3  # far below the worker floor (privacy.FACE_MIN_SCORE): near misses
FRAMES_PER_CLIP = 4        # JPEGs per clip: the frames with the strongest detections
SHOW_MIN_SCORE = 0.5       # a frame is only worth a JPEG if something scored this high
FRAME_WIDTH = 480
ZOOM_PX = 120
MAX_ZOOMS = 4

COLOURS = {"confident": (0, 0, 230), "possible": (0, 140, 255), "below": (150, 150, 150)}


def worker_class(score: float, share: float) -> str:
    """How the worker treats one detection (mirrors privacy._is_confident and the size floor)."""
    if score >= privacy.FACE_CONFIDENT_SCORE and share >= privacy.FACE_CONFIDENT_SHARE:
        return "confident"
    if score >= privacy.FACE_MIN_SCORE and share >= privacy.FACE_MIN_SHARE:
        return "possible"
    return "below"


class RawYuNet:
    """YuNet with a low score floor and no size filter, returning the landmarks too."""

    def __init__(self, model_path: str | Path | None = None, min_score: float = RAW_MIN_SCORE):
        self._path = str(model_path or privacy.yunet_path())
        self._min = min_score
        self._det: Any = None

    def detect(self, rgb: np.ndarray) -> list[dict[str, Any]]:
        h, w = rgb.shape[:2]
        if self._det is None:
            self._det = cv2.FaceDetectorYN.create(self._path, "", (w, h), self._min, 0.3, 5000)
        self._det.setInputSize((w, h))
        _, faces = self._det.detect(cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR))
        out = []
        for f in [] if faces is None else faces:
            box = [float(f[0]) / w, float(f[1]) / h, float(f[2]) / w, float(f[3]) / h]
            marks = [float(f[4 + i]) / (w if i % 2 == 0 else h) for i in range(10)]
            score = float(f[-1])
            out.append({"box": [round(v, 4) for v in box], "score": round(score, 4),
                        "landmarks": [round(v, 4) for v in marks],
                        "worker": worker_class(score, box[2])})
        return out


@dataclass
class ClipResult:
    clip_id: str
    note: str
    error: str | None = None
    frames: int = 0
    width: int = 0
    height: int = 0
    detections: list[dict[str, Any]] = field(default_factory=list)  # raw, with t_s
    worker_faces: list[dict[str, Any]] = field(default_factory=list)  # privacy.run's `faces`
    worker_possible: list[dict[str, Any]] = field(default_factory=list)
    images: list[str] = field(default_factory=list)

    def count(self, cls: str) -> int:
        return sum(d["worker"] == cls for d in self.detections)

    def max_score(self) -> float:
        return max((d["score"] for d in self.detections), default=0.0)


def analyse(video: media.DecodedVideo, detector: Any, res: ClipResult) -> ClipResult:
    """Raw detections on the frames the privacy check looks at, and the worker's own output."""
    frames = video.frames[::privacy.PRIVACY_STRIDE]
    res.frames = len(frames)
    if frames:
        res.height, res.width = frames[0].rgb.shape[:2]
    for f in frames:
        for d in detector.detect(f.rgb):
            res.detections.append({"t_s": round(float(f.t_s), 2), **d})
    out = privacy.run(video, faces=privacy.YuNetFaceDetector(),
                      documents=privacy.NoRegionDetector(), screens=privacy.NoRegionDetector(),
                      label=res.clip_id)
    if out.error:
        res.error = out.error
    else:
        res.worker_faces = list(out.measurements.get("faces") or [])
        res.worker_possible = list(out.measurements.get("faces_possible") or [])
    return res


# --- images ---------------------------------------------------------------------------------


def _zoom(rgb: np.ndarray, box: Sequence[float]) -> np.ndarray:
    """The box grown by half its size on each side, as a ZOOM_PX square (BGR)."""
    h, w = rgb.shape[:2]
    x, y, bw, bh = box[0] * w, box[1] * h, box[2] * w, box[3] * h
    side = max(bw, bh) * 2.0
    cx, cy = x + bw / 2, y + bh / 2
    x0, y0 = int(max(0, cx - side / 2)), int(max(0, cy - side / 2))
    x1, y1 = int(min(w, cx + side / 2)), int(min(h, cy + side / 2))
    crop = rgb[y0:max(y1, y0 + 1), x0:max(x1, x0 + 1)]
    crop = cv2.resize(crop, (ZOOM_PX, ZOOM_PX), interpolation=cv2.INTER_CUBIC)
    return cv2.cvtColor(crop, cv2.COLOR_RGB2BGR)


def annotate(rgb: np.ndarray, t: float, dets: Sequence[dict[str, Any]],
             clip_id: str) -> np.ndarray:
    """The frame with every detection drawn (red confident, orange possible, grey below the
    worker's floor; dots = YuNet's landmarks), a header line and a strip of zooms."""
    h, w = rgb.shape[:2]
    img = cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR).copy()
    scale = FRAME_WIDTH / w
    img = cv2.resize(img, (FRAME_WIDTH, round(h * scale)), interpolation=cv2.INTER_AREA)
    H, W = img.shape[:2]
    for d in dets:
        c = COLOURS[d["worker"]]
        x0, y0 = int(d["box"][0] * W), int(d["box"][1] * H)
        x1, y1 = x0 + int(d["box"][2] * W), y0 + int(d["box"][3] * H)
        cv2.rectangle(img, (x0, y0), (x1, y1), c, 2)
        cv2.putText(img, f"{d['score']:.2f}", (x0, max(12, y0 - 4)), cv2.FONT_HERSHEY_SIMPLEX,
                    0.45, c, 1, cv2.LINE_AA)
        lm = d.get("landmarks") or []
        for i in range(0, len(lm), 2):
            cv2.circle(img, (int(lm[i] * W), int(lm[i + 1] * H)), 2, (0, 230, 0), -1)
    best = max(dets, key=lambda d: d["score"]) if dets else None
    head = np.full((24, W, 3), 255, np.uint8)
    text = f"{clip_id} t={t:.1f}s"
    if best:
        text += (f"  best {best['score']:.2f}, width {best['box'][2] * 100:.1f}% of frame"
                 f" -> worker: {best['worker']}")
    cv2.putText(head, text, (6, 16), cv2.FONT_HERSHEY_SIMPLEX, 0.42, (0, 0, 0), 1, cv2.LINE_AA)
    rows = [head, img]
    zooms = [_zoom(rgb, d["box"]) for d in sorted(dets, key=lambda d: -d["score"])[:MAX_ZOOMS]]
    if zooms:
        strip = np.full((ZOOM_PX + 8, W, 3), 255, np.uint8)
        for i, z in enumerate(zooms):
            x = 4 + i * (ZOOM_PX + 4)
            if x + ZOOM_PX > W:
                break
            strip[4:4 + ZOOM_PX, x:x + ZOOM_PX] = z
        rows.append(strip)
    return np.vstack(rows)


def pick_times(res: ClipResult, k: int = FRAMES_PER_CLIP) -> list[float]:
    """The analysed frames with the strongest detections (at least SHOW_MIN_SCORE), the first
    confident one always included."""
    best: dict[float, float] = {}
    for d in res.detections:
        best[d["t_s"]] = max(best.get(d["t_s"], 0.0), d["score"])
    ranked = [t for t, s in sorted(best.items(), key=lambda kv: -kv[1]) if s >= SHOW_MIN_SCORE]
    out = ranked[:k]
    first = next((d["t_s"] for d in res.detections if d["worker"] == "confident"), None)
    if first is not None and first not in out:
        out = [*out[: k - 1], first]
    return sorted(out)


def save_images(video: media.DecodedVideo, res: ClipResult, out_dir: Path) -> list[str]:
    by_t = {round(float(f.t_s), 2): f for f in video.frames}
    names = []
    for t in pick_times(res):
        f = by_t.get(t)
        if f is None:
            continue
        dets = [d for d in res.detections if d["t_s"] == t]
        name = f"{res.clip_id}_t{t:05.1f}.jpg"
        cv2.imwrite(str(out_dir / name), annotate(f.rgb, t, dets, res.clip_id),
                    [cv2.IMWRITE_JPEG_QUALITY, 80])
        names.append(name)
    return names


# --- report ---------------------------------------------------------------------------------


def _first(found: Sequence[dict[str, Any]]) -> str:
    return f"{len(found)} (first at {found[0]['t_s']:.1f} s)" if found else "0"


def render(rows: Sequence[ClipResult], image_base: str, run: str) -> str:
    L = ["# Privacy check: what the face detector sees (#83)", "",
         f"{run} · the worker's own decode (frames at most {media.DEFAULT_MAX_SIDE} px, "
         f"{media.DEFAULT_SAMPLE_FPS:g} fps, privacy looks at every {privacy.PRIVACY_STRIDE}nd "
         f"frame) and YuNet (`{privacy.YUNET_FILENAME}`). Worker rule today: a face is "
         f"**confident** (reported, the rubric rejects or reviews) from score "
         f"{privacy.FACE_CONFIDENT_SCORE} and width {privacy.FACE_CONFIDENT_SHARE:.0%} of the "
         f"frame, **possible** (`faces_possible`, not used by the rubric) from "
         f"{privacy.FACE_MIN_SCORE} and {privacy.FACE_MIN_SHARE:.0%}; either needs "
         f"{privacy.PERSIST_MIN_HITS} hits within {privacy.PERSIST_WINDOW_S:g} s, anywhere in the "
         f"frame. Raw detections below are everything YuNet returns from score {RAW_MIN_SCORE}.",
         "",
         "| clip | frames analysed | worker `faces` | worker `faces_possible` | raw: confident "
         "| raw: possible | raw: below floor | best score |",
         "|---|---|---|---|---|---|---|---|"]
    for r in rows:
        if r.error and not r.frames:
            L.append(f"| {r.clip_id} ({r.note}) | failed: {r.error[:160]} | | | | | | |")
            continue
        L.append(f"| {r.clip_id} ({r.note}) | {r.frames} | {_first(r.worker_faces)} | "
                 f"{_first(r.worker_possible)} | {r.count('confident')} | {r.count('possible')} | "
                 f"{r.count('below')} | {r.max_score():.2f} |")
    L += ["", "## Frames", "",
          "Boxes: red = confident (counts as a face), orange = possible, grey = below the worker's "
          "floor. Green dots = YuNet's five landmarks (eyes, nose tip, mouth corners). Under each "
          "frame: a zoom of the strongest boxes.", ""]
    for r in rows:
        if not r.images:
            continue
        L += [f"**{r.clip_id}** ({r.note})", ""]
        L += [f"![{n}]({image_base}{n})" for n in r.images]
        L.append("")
    return "\n".join(L) + "\n"


# --- runs -----------------------------------------------------------------------------------


def run_clips(picks: Sequence[Any], fetch: Callable[[Any], Path], out_dir: Path,
              detector: Any | None = None) -> list[ClipResult]:
    detector = detector or RawYuNet()
    rows = []
    for pick in picks:
        res = ClipResult(pick.clip_id, pick.task)
        try:
            video = media.decode(fetch(pick))
            if not video.info.decodable:
                raise RuntimeError("not decodable")
            analyse(video, detector, res)
            res.images = save_images(video, res, out_dir)
        except Exception as e:  # noqa: BLE001 - reported in the table
            res.error = f"{type(e).__name__}: {e}"
        print(f"{res.clip_id}: {len(res.detections)} raw, worker faces {len(res.worker_faces)}, "
              f"best {res.max_score():.2f} {res.error or ''}", flush=True)
        rows.append(res)
    return rows


def main(argv: Sequence[str] | None = None) -> int:  # pragma: no cover - network
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawTextHelpFormatter)
    ap.add_argument("--out", type=Path, required=True, help="work directory (videos)")
    ap.add_argument("--report-dir", type=Path, required=True)
    ap.add_argument("--run", default="local run")
    a = ap.parse_args(argv)
    from .datasets import pexels as px

    a.out.mkdir(parents=True, exist_ok=True)
    a.report_dir.mkdir(parents=True, exist_ok=True)
    for old in a.report_dir.glob("*.jpg"):
        old.unlink()
    net = px.UrllibNet()
    key = os.environ.get("PEXELS_API_KEY", "")
    rows = run_clips(px.PICKS, lambda pick: px.fetch_pick(net, pick, a.out, key)[0],
                     a.report_dir)
    (a.report_dir / "README.md").write_text(render(rows, "", a.run))
    (a.report_dir / "comment.md").write_text(render(rows, "{IMAGE_BASE}", a.run))
    (a.report_dir / "results.json").write_text(json.dumps([asdict(r) for r in rows], indent=1))
    print((a.report_dir / "README.md").read_text())
    return 0


if __name__ == "__main__":  # pragma: no cover
    sys.exit(main())
