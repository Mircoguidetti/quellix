"""Real egocentric clips for the website, analysed by Ormes itself.

    python -m quellix_eval.site_clips --candidates 30 --out-dir out/site-clips \\
        --final-dir ../apps/web/public/media/clips

1. Stream candidate clips from Build AI Egocentric-10K (Apache 2.0), spread over factories.
2. Run the worker on each (privacy, technical, framing) and the hands model on sampled frames.
3. Keep only clips with no face, document or screen, both hands clearly working and decent light;
   pick the best few, from different factories and with different scenes.
4. For each pick: a short segment as MP4 (H.264) + WebM (VP9), no audio, 1280 px wide, a poster
   JPEG, and a JSON sidecar with the hands model's per-frame boxes and states, the step segments
   if the worker returns any, and the worker's decision with its reasons for that very file.

Selection is pure and tested (`select_picks`, `best_window`); the heavy parts (hands model, worker,
download) are injected so the tests run on generated clips.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from collections.abc import Callable, Iterator, Sequence
from dataclasses import dataclass, field
from fractions import Fraction
from pathlib import Path
from typing import Any, Protocol

import av
import cv2
import numpy as np

SCHEMA = "ormes.site-clip/1"
DEFAULT_RUBRIC = Path(__file__).resolve().parents[2] / "rubrics" / "site_clips.json"

SCORE_FPS = 4.0            # hands analysis rate while choosing a window
SIDECAR_FPS = 8.0          # per-frame boxes stored with the final clip
ANALYSIS_WIDTH = 640       # frames are downscaled for the hands model (boxes are normalized)
WINDOW_S = 9.0
OUT_WIDTH = 1280
MP4_BUDGET = 1_000_000     # bytes: total for 6 clips must stay under 12 MB with WebM and posters
WEBM_BUDGET = 700_000
POSTER_BUDGET = 110_000
TOTAL_BUDGET = 11_500_000

# Selection thresholds.
MIN_BOTH_FULL = 0.85       # share of window frames with both hands fully visible
MIN_WORKING = 0.60         # share of window frames with both hands visible and one in contact
LUMA_RANGE = (70.0, 185.0)  # mean luminance of the window (0-255)
MIN_CONTRAST = 28.0        # std of luminance
MAX_BLUR_RATIO = 0.10
MAX_BAD_EXPOSURE = 0.05
MIN_SCENE_DISTANCE = 0.25  # Bhattacharyya distance between colour histograms of two picks


class HandsLike(Protocol):
    """`quellix_hands.HandsModel` (or a stand-in): per-frame hand states."""

    model_id: str

    def frames(self, frames: Sequence[np.ndarray], timestamps: Sequence[float]) -> list[Any]: ...


# (video_path, rubric_path) -> (decision | None, error)
WorkerCheck = Callable[[Path, Path], dict[str, Any] | None]


# --- frames ------------------------------------------------------------------------------


def iter_frames(
    path: Path, fps: float, start_s: float = 0.0, end_s: float | None = None,
    max_width: int | None = ANALYSIS_WIDTH,
) -> Iterator[tuple[float, np.ndarray]]:
    """(t_s, RGB frame) at about `fps` between start_s and end_s; t_s counts from the file start."""
    next_t = start_s
    with av.open(str(path)) as c:
        stream = c.streams.video[0]
        stream.thread_type = "AUTO"
        for frame in c.decode(stream):
            t = float(frame.pts * stream.time_base) if frame.pts is not None else 0.0
            if t < next_t - 1e-6:
                continue
            if end_s is not None and t > end_s + 1e-6:
                break
            img = frame.to_ndarray(format="rgb24")
            if max_width and img.shape[1] > max_width:
                h = int(round(img.shape[0] * max_width / img.shape[1]))
                img = cv2.resize(img, (max_width, h), interpolation=cv2.INTER_AREA)
            yield t, img
            next_t = t + 1.0 / fps


def video_info(path: Path) -> tuple[float, int, int, float]:
    """(duration_s, width, height, fps)"""
    with av.open(str(path)) as c:
        s = c.streams.video[0]
        dur = float(c.duration / 1_000_000) if c.duration else float(s.duration * s.time_base)
        return dur, s.codec_context.width, s.codec_context.height, float(s.average_rate or 30)


# --- per-frame hand states ---------------------------------------------------------------

IN_CONTACT = frozenset({"portable_object", "stationary_object", "object"})


def frame_flags(fh: Any) -> tuple[bool, bool]:
    """(both hands fully visible, both visible and at least one in contact)."""
    both_full = fh.left.state == "full" and fh.right.state == "full"
    in_contact = any(fh.contact.get(side) in IN_CONTACT for side in ("left", "right"))
    return both_full, both_full and in_contact


@dataclass(frozen=True)
class Window:
    start_s: float
    end_s: float
    both_full: float
    working: float
    score: float


def best_window(per_frame: Sequence[Any], window_s: float = WINDOW_S) -> Window | None:
    """The `window_s` stretch with the most frames of both hands working, or None if too short."""
    if len(per_frame) < 2:
        return None
    ts = [f.t_s for f in per_frame]
    flags = [frame_flags(f) for f in per_frame]
    best: Window | None = None
    j = 0
    for i, t0 in enumerate(ts):
        while j < len(ts) and ts[j] <= t0 + window_s + 1e-6:
            j += 1
        if ts[j - 1] - t0 < window_s * 0.9:
            break        # the rest is shorter than a window
        chunk = flags[i:j]
        both_full = sum(a for a, _ in chunk) / len(chunk)
        working = sum(b for _, b in chunk) / len(chunk)
        score = 0.7 * working + 0.3 * both_full
        if best is None or score > best.score:
            best = Window(t0, min(t0 + window_s, ts[j - 1]), both_full, working, score)
    return best


def window_passes(w: Window) -> bool:
    return w.both_full >= MIN_BOTH_FULL and w.working >= MIN_WORKING


def light_ok(frames: Sequence[np.ndarray]) -> tuple[bool, float, float]:
    """(ok, mean luminance, contrast) over sample frames."""
    if not frames:
        return False, 0.0, 0.0
    gray = np.concatenate([cv2.cvtColor(f, cv2.COLOR_RGB2GRAY).ravel() for f in frames])
    mean, std = float(gray.mean()), float(gray.std())
    return LUMA_RANGE[0] <= mean <= LUMA_RANGE[1] and std >= MIN_CONTRAST, mean, std


def histogram(img: np.ndarray) -> np.ndarray:
    hsv = cv2.cvtColor(img, cv2.COLOR_RGB2HSV)
    h = cv2.calcHist([hsv], [0, 1, 2], None, [8, 8, 8], [0, 180, 0, 256, 0, 256])
    return cv2.normalize(h, h).astype(np.float32)


def scene_distance(a: np.ndarray, b: np.ndarray) -> float:
    return float(cv2.compareHist(a, b, cv2.HISTCMP_BHATTACHARYYA))


# --- worker decision ---------------------------------------------------------------------


def measurements(decision: dict[str, Any], check: str) -> dict[str, Any]:
    return dict(decision.get("checks", {}).get(check, {}).get("measurements") or {})


def privacy_clean(decision: dict[str, Any]) -> bool:
    """No face, document or screen anywhere, and the privacy check really ran."""
    check = decision.get("checks", {}).get("privacy", {})
    if check.get("status") not in ("pass", "fail"):
        return False
    m = measurements(decision, "privacy")
    return not (m.get("faces") or m.get("documents") or m.get("screens"))


def technical_ok(decision: dict[str, Any]) -> bool:
    check = decision.get("checks", {}).get("technical", {})
    if check.get("status") not in ("pass", "fail"):
        return False
    m = measurements(decision, "technical")
    return (m.get("decodable", True) is not False
            and m.get("blur_ratio", 0.0) <= MAX_BLUR_RATIO
            and m.get("bad_exposure_ratio", 0.0) <= MAX_BAD_EXPOSURE)


# --- candidates and picks ----------------------------------------------------------------


@dataclass
class Candidate:
    clip_id: str
    path: Path
    factory: str
    decision: dict[str, Any] | None = None
    window: Window | None = None
    luma: float = 0.0
    contrast: float = 0.0
    hist: np.ndarray | None = field(default=None, repr=False)
    rejected: str | None = None       # why it is not eligible

    @property
    def score(self) -> float:
        return self.window.score if self.window else 0.0


def eligibility(c: Candidate) -> str | None:
    """None when the candidate may be picked, else the reason it may not."""
    if c.decision is None:
        return "worker failed"
    if not privacy_clean(c.decision):
        return "face, document or screen detected (or privacy not measured)"
    if not technical_ok(c.decision):
        return "blurry, badly exposed or not decodable"
    if c.window is None or not window_passes(c.window):
        return "no stretch with both hands clearly working"
    if not (LUMA_RANGE[0] <= c.luma <= LUMA_RANGE[1] and c.contrast >= MIN_CONTRAST):
        return "poor light"
    return None


def select_picks(
    candidates: Sequence[Candidate], n: int = 6, min_distance: float = MIN_SCENE_DISTANCE
) -> list[Candidate]:
    """Best `n` eligible candidates: distinct factories first, and visibly different scenes."""
    eligible = []
    for c in candidates:
        c.rejected = eligibility(c)
        if c.rejected is None:
            eligible.append(c)
    eligible.sort(key=lambda c: c.score, reverse=True)

    def different(c: Candidate, picked: Sequence[Candidate]) -> bool:
        return all(
            c.hist is None or p.hist is None or scene_distance(c.hist, p.hist) >= min_distance
            for p in picked
        )

    picks: list[Candidate] = []
    for distinct_factories in (True, False):     # second pass fills up if factories ran out
        for c in eligible:
            if len(picks) >= n:
                break
            if c in picks or not different(c, picks):
                continue
            if distinct_factories and any(p.factory == c.factory for p in picks):
                continue
            picks.append(c)
    for c in eligible:
        if c not in picks:
            c.rejected = "eligible, but not among the best picks (same factory or similar scene)"
    return picks


def factory_of(clip_id: str) -> str:
    m = re.search(r"factory\d+", clip_id)
    return m.group(0) if m else clip_id


def analyse(
    clip_id: str, path: Path, hands: HandsLike, worker: WorkerCheck, rubric: Path,
    window_s: float = WINDOW_S,
) -> Candidate:
    cand = Candidate(clip_id, path, factory_of(clip_id))
    cand.decision = worker(path, rubric)
    if cand.decision is None or not privacy_clean(cand.decision):
        return cand            # no need to run the hands model on a clip that is out already
    samples = list(iter_frames(path, SCORE_FPS))
    if not samples:
        return cand
    ts, frames = [t for t, _ in samples], [f for _, f in samples]
    per_frame = hands.frames(frames, ts)
    cand.window = best_window(per_frame, window_s)
    if cand.window is not None:
        inside = [f for t, f in samples if cand.window.start_s <= t <= cand.window.end_s]
        ok, cand.luma, cand.contrast = light_ok(inside)
        if inside:
            cand.hist = histogram(inside[len(inside) // 2])
    return cand


# --- encoding ----------------------------------------------------------------------------


def _scaled(frames: Iterator[tuple[float, np.ndarray]], width: int) -> Iterator[np.ndarray]:
    for _, img in frames:
        h, w = img.shape[:2]
        new_w = width - width % 2
        new_h = int(round(h * new_w / w)) // 2 * 2
        yield cv2.resize(img, (new_w, new_h), interpolation=cv2.INTER_AREA)


def encode(
    frames: Iterator[np.ndarray], dst: Path, codec: str, fps: float, options: dict[str, str]
) -> int:
    """Encode RGB frames to `dst` (no audio). Returns the file size in bytes."""
    dst.parent.mkdir(parents=True, exist_ok=True)
    with av.open(str(dst), "w") as out:
        stream = None
        for img in frames:
            if stream is None:
                stream = out.add_stream(codec, rate=Fraction(fps).limit_denominator(1000))
                stream.height, stream.width = img.shape[:2]
                stream.pix_fmt = "yuv420p"
                stream.options = options
            vf = av.VideoFrame.from_ndarray(np.ascontiguousarray(img), format="rgb24")
            for p in stream.encode(vf):
                out.mux(p)
        if stream is None:
            raise ValueError("no frames to encode")
        for p in stream.encode():
            out.mux(p)
    return dst.stat().st_size


def fit(
    make_frames: Callable[[], Iterator[np.ndarray]], dst: Path, codec: str, fps: float,
    budget: int, levels: Sequence[int], opts: Callable[[int], dict[str, str]],
) -> tuple[int, int]:
    """Encode at the best quality (lowest crf) whose file fits `budget`. Returns (crf, bytes)."""
    size = 0
    for crf in levels:
        size = encode(make_frames(), dst, codec, fps, opts(crf))
        if size <= budget:
            return crf, size
    return levels[-1], size


def write_poster(img: np.ndarray, dst: Path, budget: int = POSTER_BUDGET) -> int:
    dst.parent.mkdir(parents=True, exist_ok=True)
    bgr = cv2.cvtColor(img, cv2.COLOR_RGB2BGR)
    for quality in (82, 74, 66, 58, 50, 42):
        cv2.imwrite(str(dst), bgr, [cv2.IMWRITE_JPEG_QUALITY, quality])
        if dst.stat().st_size <= budget:
            break
    return dst.stat().st_size


def render_clip(
    cand: Candidate, name: str, out_dir: Path, fps_out: float | None = None,
    width: int = OUT_WIDTH,
) -> dict[str, Any]:
    """Cut the chosen window of the candidate into <name>.mp4 / .webm / .jpg."""
    assert cand.window is not None
    w = cand.window
    _, _, _, src_fps = video_info(cand.path)
    fps = fps_out or min(src_fps, 24.0)

    def frames() -> Iterator[np.ndarray]:
        return _scaled(iter_frames(cand.path, fps, w.start_s, w.end_s, max_width=None), width)

    mp4, webm, jpg = out_dir / f"{name}.mp4", out_dir / f"{name}.webm", out_dir / f"{name}.jpg"
    crf_mp4, size_mp4 = fit(
        frames, mp4, "libx264", fps, MP4_BUDGET, (24, 26, 28, 30, 32, 35),
        lambda crf: {"crf": str(crf), "preset": "slow", "movflags": "+faststart"})
    crf_webm, size_webm = fit(
        frames, webm, "libvpx-vp9", fps, WEBM_BUDGET, (34, 36, 38, 40, 43, 46),
        lambda crf: {"crf": str(crf), "b:v": "0", "row-mt": "1", "cpu-used": "2"})
    # Poster: the sharpest of a few frames around the middle of the window.
    mid = (w.start_s + w.end_s) / 2
    options = list(_scaled(iter_frames(cand.path, 8, mid - 0.5, mid + 0.5, max_width=None), width))
    poster = max(options, key=lambda f: cv2.Laplacian(
        cv2.cvtColor(f, cv2.COLOR_RGB2GRAY), cv2.CV_64F).var())
    size_jpg = write_poster(poster, jpg)
    duration, width_px, height_px, fps_real = video_info(mp4)
    return {
        "mp4": mp4.name, "webm": webm.name, "poster": jpg.name,
        "width": width_px, "height": height_px, "fps": round(fps_real, 2),
        "duration_s": round(duration, 2),
        "bytes": {"mp4": size_mp4, "webm": size_webm, "poster": size_jpg},
        "crf": {"mp4": crf_mp4, "webm": crf_webm},
    }


# --- sidecar -----------------------------------------------------------------------------


def hand_box(obs: Any) -> list[float] | None:
    """Normalized [x0, y0, x1, y1] of a hand: the detector's box, else the keypoints' extent."""
    box = getattr(obs, "box", None)
    if box is None and getattr(obs, "keypoints", None) is not None:
        kp = np.asarray(obs.keypoints, dtype=float)[:, :2]
        box = (kp[:, 0].min(), kp[:, 1].min(), kp[:, 0].max(), kp[:, 1].max())
    return None if box is None else [round(float(v), 3) for v in box]


def frames_json(per_frame: Sequence[Any]) -> list[dict[str, Any]]:
    out = []
    for f in per_frame:
        row: dict[str, Any] = {"t": round(float(f.t_s), 3)}
        for side in ("left", "right"):
            obs = f.hand(side)
            row[side] = {
                "state": obs.state,
                "box": hand_box(obs) if obs.state != "absent" else None,
                "contact": f.contact.get(side, "unknown"),
            }
        out.append(row)
    return out


def steps_from(decision: dict[str, Any] | None) -> list[dict[str, Any]]:
    if not decision:
        return []
    return list(measurements(decision, "task_completed").get("steps") or [])


def build_sidecar(
    cand: Candidate, name: str, files: dict[str, Any], hands: HandsLike,
    decision: dict[str, Any] | None, mp4: Path, dataset: str, license_: str,
) -> dict[str, Any]:
    samples = list(iter_frames(mp4, SIDECAR_FPS))
    per_frame = hands.frames([f for _, f in samples], [t for t, _ in samples])
    assert cand.window is not None
    return {
        "schema": SCHEMA,
        "id": name,
        "source": {"dataset": dataset, "license": license_, "clip_id": cand.clip_id,
                   "factory": cand.factory,
                   "segment_in_source_s": [round(cand.window.start_s, 2),
                                           round(cand.window.end_s, 2)]},
        "video": files,
        "hands": {"model": hands.model_id, "sample_fps": SIDECAR_FPS,
                  "frames": frames_json(per_frame)},
        "steps": steps_from(decision),
        "decision": decision,
        "selection": {"both_hands_full": round(cand.window.both_full, 3),
                      "both_hands_working": round(cand.window.working, 3),
                      "mean_luminance": round(cand.luma, 1), "contrast": round(cand.contrast, 1)},
    }


# --- orchestration -----------------------------------------------------------------------


def produce(
    candidates: Sequence[Candidate], hands: HandsLike, worker: WorkerCheck, rubric: Path,
    final_dir: Path, picks_wanted: int = 6, dataset: str = "Build AI Egocentric-10K",
    license_: str = "Apache-2.0", log: Callable[[str], None] = print, width: int = OUT_WIDTH,
) -> dict[str, Any]:
    picks = select_picks(candidates, picks_wanted)
    final_dir.mkdir(parents=True, exist_ok=True)
    for old in [*final_dir.glob("clip-*"), final_dir / "manifest.json"]:
        old.unlink(missing_ok=True)       # a run with fewer picks must not leave stale clips
    clips: list[dict[str, Any]] = []
    for i, cand in enumerate(picks, 1):
        name = f"clip-{i:02d}"
        files = render_clip(cand, name, final_dir, width=width)
        mp4 = final_dir / files["mp4"]
        decision = worker(mp4, rubric)        # the worker's verdict on the delivered file itself
        sidecar = build_sidecar(cand, name, files, hands, decision, mp4, dataset, license_)
        side = final_dir / f"{name}.json"
        side.write_text(json.dumps(sidecar, separators=(",", ":")))
        files["bytes"]["json"] = side.stat().st_size
        clips.append({"id": name, "source_clip": cand.clip_id, "factory": cand.factory,
                      "decision": (decision or {}).get("decision"), **files})
        log(f"{name}: {cand.clip_id} {cand.window.start_s:.1f}-{cand.window.end_s:.1f}s "  # type: ignore[union-attr]
            f"bytes={files['bytes']}")
    total = sum(sum(c["bytes"].values()) for c in clips)
    manifest = {"schema": "ormes.site-clips/1", "dataset": dataset, "license": license_,
                "total_bytes": total, "clips": clips}
    (final_dir / "manifest.json").write_text(json.dumps(manifest, indent=2))
    if total > TOTAL_BUDGET:
        raise RuntimeError(f"clips are {total} bytes, over the {TOTAL_BUDGET} budget")
    return manifest


def candidate_report(candidates: Sequence[Candidate], picks: Sequence[Candidate]) -> str:
    """A markdown table: every candidate, whether it was picked, and why not."""
    picked = {c.clip_id for c in picks}
    lines = ["| clip | factory | result | window | both hands full | working | light |",
             "|---|---|---|---|---|---|---|"]
    for c in sorted(candidates, key=lambda c: (c.clip_id not in picked, -c.score)):
        w = c.window
        result = "**picked**" if c.clip_id in picked else (c.rejected or "not eligible")
        lines.append(
            f"| `{c.clip_id}` | {c.factory} | {result} | "
            + (f"{w.start_s:.1f}-{w.end_s:.1f} s | {w.both_full:.2f} | {w.working:.2f} | "
               f"{c.luma:.0f} / {c.contrast:.0f}" if w else "- | - | - | -")
            + " |")
    return "\n".join(lines) + "\n"


def worker_check_via_cli(cmd: Sequence[str] | None = None) -> WorkerCheck:  # pragma: no cover
    from .run import worker_engine

    engine = worker_engine(cmd)

    def check(video: Path, rubric: Path) -> dict[str, Any] | None:
        from .datasets.manifest import ClipRecord, TaskSpec

        clip = ClipRecord(clip_id=video.stem, source="synthetic", license="synthetic",
                          path=str(video), task=TaskSpec(description="Factory work."),
                          truth="accept")
        return engine(clip, json.loads(rubric.read_text())).decision

    return check


def main(argv: Sequence[str] | None = None) -> int:  # pragma: no cover - network, models
    from .datasets import egocentric10k
    from .datasets.manifest import load_manifest

    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawTextHelpFormatter)
    ap.add_argument("--candidates", type=int, default=30)
    ap.add_argument("--picks", type=int, default=6)
    ap.add_argument("--min-picks", type=int, default=1)
    ap.add_argument("--out-dir", type=Path, default=Path("out/site-clips"))
    ap.add_argument("--final-dir", type=Path, default=Path("out/site-clips/final"))
    ap.add_argument("--rubric", type=Path, default=DEFAULT_RUBRIC)
    ap.add_argument("--seconds", type=float, default=30.0)
    a = ap.parse_args(argv)

    from quellix_hands.model import HandsModel

    a.out_dir.mkdir(parents=True, exist_ok=True)
    manifest_path = a.out_dir / "candidates.jsonl"
    n = egocentric10k.build(
        manifest_path, a.out_dir / "candidates", clips=a.candidates, per_shard=2,
        seconds=a.seconds, width=OUT_WIDTH, fps=24.0, min_factories=min(15, a.candidates),
        codec="libx264", options={"crf": "17", "preset": "veryfast"})
    print(f"downloaded {n} candidates")
    hands, worker = HandsModel(), worker_check_via_cli()
    cands = []
    for rec in load_manifest(manifest_path):
        cand = analyse(rec.clip_id, Path(rec.path), hands, worker, a.rubric)
        print(f"{rec.clip_id}: " + (eligibility(cand) or "eligible"), flush=True)
        cands.append(cand)
    manifest = produce(cands, hands, worker, a.rubric, a.final_dir, a.picks)
    picks = [c for c in cands if c.clip_id in {x["source_clip"] for x in manifest["clips"]}]
    (a.out_dir / "candidates.md").write_text(candidate_report(cands, picks))
    print(f"{len(manifest['clips'])} clips, {manifest['total_bytes']} bytes")
    return 0 if len(manifest["clips"]) >= a.min_picks else 1


if __name__ == "__main__":  # pragma: no cover
    sys.exit(main())
