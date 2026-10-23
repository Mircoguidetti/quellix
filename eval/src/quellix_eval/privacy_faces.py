"""A real-face test set for the privacy check, and per-detection features to tune on (#83).

    python -m quellix_eval.privacy_faces collect --out out/faces --report-dir reports/privacy-faces

Sources (all allowed for commercial use):
- Pixabay (Pixabay Content License), found by search query: queries that should show a face
  (frontal, turned, small, cut by the frame edge) and queries that should not (worktops, hands
  at work seen from above). Needs `PIXABAY_API_KEY`.
- The founder's Pexels clips (Pexels License): the first-person landing clips and the
  third-person clips (the countertop clip shows a real face).
- HoloAssist (CDLA-Permissive-2.0) task windows and Egocentric-10K (Apache 2.0) clips: real
  first-person work footage, where a face would be another person in view.

Labels: each clip gets a *proposed* label from its source (the query group, or the clip list).
The contact sheets show every clip so a person confirms or corrects it; corrections go in
`test_sets/privacy_faces_labels.json` ({clip_id: "face" | "no_face" | "drop"}). Ormes's output
is never a label. A clip is "face" when a real human face (frontal, profile or partly turned,
or cut by the frame edge with the mouth or the eyes visible) is in view.

Split: a fixed hash of the clip id puts 60% of the clips in `dev` (rules are tuned there) and
40% in `heldout` (scored once).

Per clip, every raw YuNet detection on the frames the privacy check analyses is recorded with
its score, size and landmarks, plus YuNet's score on the box crop redrawn at several face sizes
and mirrored (`scale_scores`, `flip_score`): a real face stays a face at another size, a texture
coincidence (a bowl of coffee with a spoon) usually does not.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
from collections.abc import Callable, Iterable, Sequence
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any

import cv2
import numpy as np
from quellix_worker import media
from quellix_worker.checks import privacy

from .privacy_diagnosis import RawYuNet

LABELS_PATH = Path(__file__).resolve().parents[2] / "test_sets" / "privacy_faces_labels.json"
MANIFEST_PATH = Path(__file__).resolve().parents[2] / "test_sets" / "privacy_faces.jsonl"
DEV_SHARE = 0.6
FEATURE_MIN_SCORE = 0.5      # detections below this are recorded without the extra features
FACE_SIZES = (24, 40, 64, 112)  # px: the face box is redrawn at these widths for scale_scores
PER_QUERY = 4
SHEET_ROWS = 8
THUMB_H = 90
THUMBS = 6

# (query, proposed label, group). Groups are reported separately: a rule that only works on
# big frontal faces must show it.
QUERIES: tuple[tuple[str, str, str], ...] = (
    ("woman talking to camera", "face", "frontal"),
    ("man talking", "face", "frontal"),
    ("portrait smiling", "face", "frontal"),
    ("elderly man face", "face", "frontal"),
    ("woman profile", "face", "turned"),
    ("man looking away", "face", "turned"),
    ("person thinking side view", "face", "turned"),
    ("people walking street", "face", "small"),
    ("crowd", "face", "small"),
    ("office meeting", "face", "small"),
    ("chef cooking kitchen", "face", "at work"),
    ("woman cooking", "face", "at work"),
    ("factory worker", "face", "at work"),
    ("mechanic working", "face", "at work"),
    ("marble texture", "no_face", "worktop"),
    ("granite countertop", "no_face", "worktop"),
    ("wood texture", "no_face", "worktop"),
    ("kitchen counter top view", "no_face", "worktop"),
    ("chopping vegetables", "no_face", "hands at work"),
    ("kneading dough", "no_face", "hands at work"),
    ("pouring coffee", "no_face", "hands at work"),
    ("coffee grinder", "no_face", "hands at work"),
    ("mortar and pestle", "no_face", "hands at work"),
    ("pottery wheel hands", "no_face", "hands at work"),
    ("sewing machine hands", "no_face", "hands at work"),
    ("soldering", "no_face", "hands at work"),
)

# Batch 2 (after the first sheets): more faces (the first batch kept only 22 after the eye
# check) and hard negatives like the pestle clip: round things seen from above, food, bowls.
QUERIES_2: tuple[tuple[str, str, str], ...] = (
    ("woman face closeup", "face", "frontal"),
    ("man portrait", "face", "frontal"),
    ("interview", "face", "frontal"),
    ("video call", "face", "frontal"),
    ("girl smiling", "face", "frontal"),
    ("old woman", "face", "frontal"),
    ("man wearing glasses", "face", "frontal"),
    ("woman hijab", "face", "frontal"),
    ("man drinking coffee", "face", "turned"),
    ("woman reading book", "face", "turned"),
    ("man on phone", "face", "turned"),
    ("couple talking", "face", "turned"),
    ("classroom students", "face", "small"),
    ("market people", "face", "small"),
    ("audience", "face", "small"),
    ("barista", "face", "at work"),
    ("carpenter workshop", "face", "at work"),
    ("doctor", "face", "at work"),
    ("baker", "face", "at work"),
    ("soup bowl top view", "no_face", "round things"),
    ("fruit bowl", "no_face", "round things"),
    ("coffee cup top view", "no_face", "round things"),
    ("pizza", "no_face", "round things"),
    ("cake decorating", "no_face", "round things"),
    ("frying eggs", "no_face", "round things"),
    ("plates table top view", "no_face", "round things"),
    ("spices bowls", "no_face", "round things"),
    ("cooking pot stirring", "no_face", "hands at work"),
    ("baking cookies", "no_face", "hands at work"),
    ("assembling parts hands", "no_face", "hands at work"),
)
BATCHES = {1: QUERIES, 2: QUERIES_2}
CROP_MIN_SCORE = 0.6
CROP_PX = 72
MAX_CROPS = 12

# Pexels: what each of the founder's clips shows (looked at in the #83 diagnosis frames).
PEXELS_FACE = {5592524: ("face", "turned")}  # the man at the top edge, in profile


def split_of(clip_id: str) -> str:
    h = int(hashlib.sha1(clip_id.encode()).hexdigest()[:8], 16)
    return "dev" if (h % 1000) / 1000 < DEV_SHARE else "heldout"


@dataclass
class FaceClip:
    clip_id: str
    source: str
    license: str
    page_url: str
    proposed: str               # "face" | "no_face"
    group: str
    query: str = ""
    split: str = ""
    path: str = ""              # local file (never committed)
    error: str | None = None
    frames: int = 0
    width: int = 0
    height: int = 0
    detections: list[dict[str, Any]] = field(default_factory=list)
    sheet: str = ""
    crops: str = ""

    def __post_init__(self) -> None:
        self.split = self.split or split_of(self.clip_id)


def labels(path: Path = LABELS_PATH) -> dict[str, str]:
    return json.loads(path.read_text()) if path.exists() else {}


def final_label(clip: FaceClip, overrides: dict[str, str]) -> str:
    return overrides.get(clip.clip_id, clip.proposed)


# --- features -------------------------------------------------------------------------------


def _crop_for(rgb: np.ndarray, box: Sequence[float], face_px: int) -> tuple[np.ndarray, float]:
    """A square around the box (twice its size, padded with grey past the frame edge),
    redrawn so the box is ``face_px`` wide. Returns (crop, scale)."""
    h, w = rgb.shape[:2]
    bw, bh = box[2] * w, box[3] * h
    side = max(bw, bh) * 2.0
    cx, cy = (box[0] + box[2] / 2) * w, (box[1] + box[3] / 2) * h
    x0, y0 = int(round(cx - side / 2)), int(round(cy - side / 2))
    s = max(1, int(round(side)))
    pad = s
    padded = cv2.copyMakeBorder(rgb, pad, pad, pad, pad, cv2.BORDER_CONSTANT, value=(128,) * 3)
    crop = padded[y0 + pad:y0 + pad + s, x0 + pad:x0 + pad + s]
    scale = face_px / max(bw, 1.0)
    size = max(16, int(round(s * scale)))
    interp = cv2.INTER_AREA if scale < 1 else cv2.INTER_CUBIC
    return cv2.resize(crop, (size, size), interpolation=interp), scale


class CropScorer:
    """YuNet's best score for a face near the centre of a crop (any size)."""

    def __init__(self, model_path: str | Path | None = None) -> None:
        self._path = str(model_path or privacy.yunet_path())
        self._det: Any = None

    def __call__(self, crop_rgb: np.ndarray) -> float:
        h, w = crop_rgb.shape[:2]
        if self._det is None:
            self._det = cv2.FaceDetectorYN.create(self._path, "", (w, h), 0.05, 0.3, 50)
        self._det.setInputSize((w, h))
        _, faces = self._det.detect(cv2.cvtColor(crop_rgb, cv2.COLOR_RGB2BGR))
        best = 0.0
        for f in [] if faces is None else faces:
            cx, cy = (f[0] + f[2] / 2) / w, (f[1] + f[3] / 2) / h
            if abs(cx - 0.5) <= 0.25 and abs(cy - 0.5) <= 0.25:
                best = max(best, float(f[-1]))
        return round(best, 4)


def detection_features(rgb: np.ndarray, det: dict[str, Any], scorer: Callable) -> dict[str, Any]:
    out: dict[str, Any] = {}
    for px in FACE_SIZES:
        crop, _ = _crop_for(rgb, det["box"], px)
        out[str(px)] = scorer(crop)
    native = det["box"][2] * rgb.shape[1]
    crop, _ = _crop_for(rgb, det["box"], max(16, int(round(native))))
    return {"scale_scores": out, "flip_score": scorer(np.ascontiguousarray(crop[:, ::-1])),
            "native_px": round(native, 1)}


def analyse(clip: FaceClip, video: media.DecodedVideo, detector: Any, scorer: Callable) -> None:
    frames = video.frames[::privacy.PRIVACY_STRIDE]
    clip.frames = len(frames)
    if frames:
        clip.height, clip.width = frames[0].rgb.shape[:2]
    for f in frames:
        for d in detector.detect(f.rgb):
            d = {"t_s": round(float(f.t_s), 2), **d}
            if d["score"] >= FEATURE_MIN_SCORE:
                d.update(detection_features(f.rgb, d, scorer))
            clip.detections.append(d)


# --- contact sheets -------------------------------------------------------------------------


def thumbs_row(video: media.DecodedVideo, clip: FaceClip, overrides: dict[str, str],
               width: int = 1000) -> np.ndarray:
    frames = video.frames
    idx = [int(round(x)) for x in np.linspace(0, len(frames) - 1, THUMBS)] if frames else []
    tiles = []
    for i in idx:
        f = frames[i].rgb
        h, w = f.shape[:2]
        t = cv2.resize(f, (max(1, round(w * THUMB_H / h)), THUMB_H), interpolation=cv2.INTER_AREA)
        tiles.append(cv2.cvtColor(t, cv2.COLOR_RGB2BGR))
    body = np.hstack(tiles) if tiles else np.zeros((THUMB_H, 10, 3), np.uint8)
    body = body[:, :width]
    if body.shape[1] < width:
        body = np.hstack([body, np.full((THUMB_H, width - body.shape[1], 3), 255, np.uint8)])
    label = final_label(clip, overrides)
    head = np.full((20, width, 3), 255, np.uint8)
    text = f"{clip.clip_id}  [{clip.split}]  {clip.group}: {clip.query or clip.source}  -> {label}"
    colour = (0, 0, 200) if label == "face" else (0, 120, 0)
    cv2.putText(head, text, (4, 14), cv2.FONT_HERSHEY_SIMPLEX, 0.45, colour, 1, cv2.LINE_AA)
    return np.vstack([head, body, np.full((4, width, 3), 255, np.uint8)])


def save_crops(video: media.DecodedVideo, clip: FaceClip, out_dir: Path) -> str:
    """The strongest detections (from CROP_MIN_SCORE) as a strip of zooms with their time and
    score, so a person can check what was found before trusting a label."""
    by_t = {round(float(f.t_s), 2): f for f in video.frames}
    dets = sorted((d for d in clip.detections if d["score"] >= CROP_MIN_SCORE),
                  key=lambda d: -d["score"])[:MAX_CROPS]
    tiles = []
    for d in dets:
        f = by_t.get(d["t_s"])
        if f is None:
            continue
        crop, _ = _crop_for(f.rgb, d["box"], CROP_PX // 2)
        crop = cv2.resize(crop, (CROP_PX, CROP_PX), interpolation=cv2.INTER_AREA)
        tile = np.vstack([np.full((14, CROP_PX, 3), 255, np.uint8),
                          cv2.cvtColor(crop, cv2.COLOR_RGB2BGR)])
        cv2.putText(tile, f"{d['t_s']:.1f}s {d['score']:.2f}", (2, 11),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.32, (0, 0, 0), 1, cv2.LINE_AA)
        tiles.append(tile)
    if not tiles:
        return ""
    (out_dir / "crops").mkdir(parents=True, exist_ok=True)
    name = f"crops/{clip.clip_id}.jpg"
    cv2.imwrite(str(out_dir / name), np.hstack(tiles), [cv2.IMWRITE_JPEG_QUALITY, 80])
    return name


def write_sheets(rows: Sequence[tuple[FaceClip, np.ndarray]], out_dir: Path) -> list[str]:
    names = []
    for k in range(0, len(rows), SHEET_ROWS):
        chunk = rows[k:k + SHEET_ROWS]
        name = f"sheet-{k // SHEET_ROWS + 1:02d}.jpg"
        cv2.imwrite(str(out_dir / name), np.vstack([r for _, r in chunk]),
                    [cv2.IMWRITE_JPEG_QUALITY, 70])
        for c, _ in chunk:
            c.sheet = name
        names.append(name)
    return names


# --- sources --------------------------------------------------------------------------------


def pixabay_clips(net: Any, key: str, per_query: int = PER_QUERY,
                  queries: Iterable[tuple[str, str, str]] = QUERIES,
                  exclude: Sequence[int] = ()) -> list[tuple[FaceClip, Any]]:
    from .datasets import pixabay as pb

    out: list[tuple[FaceClip, Any]] = []
    seen: list[int] = list(exclude)
    for q, proposed, group in queries:
        try:
            hits = pb.search(net, key, q, per_query, exclude=seen)
        except Exception as e:  # noqa: BLE001 - one failed query must not stop the run
            print(f"pixabay {q!r}: {type(e).__name__}: {e}", flush=True)
            continue
        for h in hits:
            seen.append(h.pixabay_id)
            out.append((FaceClip(h.clip_id, "pixabay", pb.LICENSE, h.page_url, proposed, group,
                                 q), h))
    return out


def pixabay_known(net: Any, key: str,
                  known: Sequence[dict[str, Any]]) -> list[tuple[FaceClip, Any]]:
    """Clips of an earlier batch (manifest rows), fetched again by id."""
    from .datasets import pixabay as pb

    out = []
    for row in known:
        if row.get("source") != "pixabay":
            continue
        try:
            hit = pb.by_id(net, key, int(row["clip_id"].removeprefix("pixabay_")))
        except Exception as e:  # noqa: BLE001
            print(f"{row['clip_id']}: {type(e).__name__}: {e}", flush=True)
            continue
        out.append((FaceClip(row["clip_id"], "pixabay", pb.LICENSE, row["page_url"],
                             row["proposed"], row["group"], row.get("query", "")), hit))
    return out


def pexels_face_clips() -> list[tuple[FaceClip, Any]]:
    from .datasets import pexels as px

    out = []
    for pick in px.PICKS:
        proposed, group = PEXELS_FACE.get(
            pick.pexels_id,
            ("no_face", "first-person" if pick in px.LANDING_CLIPS else "third-person"))
        out.append((FaceClip(pick.clip_id, "pexels", "Pexels License", pick.page, proposed,
                             group, pick.task), pick))
    return out


# --- run ------------------------------------------------------------------------------------


def run(items: Sequence[tuple[FaceClip, Any]], fetch: Callable[[FaceClip, Any], Path],
        sheet_dir: Path, detector: Any | None = None, scorer: Callable | None = None,
        overrides: dict[str, str] | None = None) -> list[FaceClip]:
    detector = detector or RawYuNet()
    scorer = scorer or CropScorer()
    overrides = labels() if overrides is None else overrides
    rows: list[tuple[FaceClip, np.ndarray]] = []
    done = []
    for clip, src in items:
        try:
            clip.path = str(fetch(clip, src))
            video = media.decode(Path(clip.path))
            if not video.info.decodable:
                raise RuntimeError("not decodable")
            analyse(clip, video, detector, scorer)
            rows.append((clip, thumbs_row(video, clip, overrides)))
            clip.crops = save_crops(video, clip, sheet_dir)
        except Exception as e:  # noqa: BLE001 - reported in the manifest
            clip.error = f"{type(e).__name__}: {e}"
        best = max((d["score"] for d in clip.detections), default=0.0)
        print(f"{clip.clip_id} [{clip.group}] {clip.proposed}: {len(clip.detections)} raw, "
              f"best {best:.2f} {clip.error or ''}", flush=True)
        done.append(clip)
    write_sheets(rows, sheet_dir)
    return done


def features_dump(clips: Sequence[FaceClip], min_score: float = 0.45) -> list[dict[str, Any]]:
    """Every clip with its detections from ``min_score`` (keeps the committed file small)."""
    out = []
    for c in clips:
        d = asdict(c)
        d["detections"] = [x for x in c.detections if x["score"] >= min_score]
        d["n_detections_below"] = len(c.detections) - len(d["detections"])
        out.append(d)
    return out


def manifest_lines(clips: Sequence[FaceClip]) -> list[str]:
    keep = ("clip_id", "source", "license", "page_url", "proposed", "group", "query", "split",
            "error")
    return [json.dumps({k: asdict(c)[k] for k in keep}) for c in clips]


def render_sheets(clips: Sequence[FaceClip], image_base: str, run_label: str,
                  only_new: set[str] | None = None) -> str:
    """The report. With ``only_new``, only the sheets holding one of those clips are shown
    (the others were already checked)."""
    ok = [c for c in clips if not c.error]
    by = {(g, p) for g, p in ((c.group, c.proposed) for c in ok)}
    L = ["# Privacy face test set: contact sheets (#83)", "",
         f"{run_label} · {len(ok)} clips ({sum(c.proposed == 'face' for c in ok)} proposed "
         f"`face`, {sum(c.proposed == 'no_face' for c in ok)} proposed `no_face`), "
         f"{sum(c.split == 'dev' for c in ok)} dev / {sum(c.split == 'heldout' for c in ok)} "
         "held-out. Each row: 6 frames across the clip, the clip id, its split, its group and "
         "query, and the proposed label (red = face, green = no face). **Veto:** name any clip "
         "whose label is wrong (or that should be dropped).", "",
         "| group | proposed | clips |", "|---|---|---|"]
    for g, p in sorted(by):
        L.append(f"| {g} | {p} | {sum(c.group == g and c.proposed == p for c in ok)} |")
    failed = [c for c in clips if c.error]
    if failed:
        L += ["", f"{len(failed)} clips failed: " + "; ".join(
            f"{c.clip_id} ({(c.error or '')[:80]})" for c in failed[:20])]
    L.append("")
    shown = sorted({c.sheet for c in ok if c.sheet and (only_new is None
                                                       or c.clip_id in only_new)})
    if only_new is not None:
        L += [f"Sheets with clips new in this batch only ({len(shown)}); every sheet and the "
              "detection crops (`crops/<clip_id>.jpg`) are in the branch.", ""]
    for name in shown:
        L += [f"![{name}]({image_base}{name})", ""]
    return "\n".join(L) + "\n"


def main(argv: Sequence[str] | None = None) -> int:  # pragma: no cover - network
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawTextHelpFormatter)
    ap.add_argument("stage", choices=["collect"])
    ap.add_argument("--out", type=Path, required=True)
    ap.add_argument("--report-dir", type=Path, required=True)
    ap.add_argument("--per-query", type=int, default=PER_QUERY)
    ap.add_argument("--batch", type=int, default=1, choices=sorted(BATCHES),
                    help="query batch; earlier batches' Pixabay clips are fetched again by id")
    ap.add_argument("--holoassist", type=int, default=12, help="HoloAssist sessions")
    ap.add_argument("--egocentric", type=int, default=16, help="Egocentric-10K clips")
    ap.add_argument("--run", default="local run")
    a = ap.parse_args(argv)
    from .datasets import pexels as px
    from .datasets import pixabay as pb

    a.out.mkdir(parents=True, exist_ok=True)
    a.report_dir.mkdir(parents=True, exist_ok=True)
    for old in [*a.report_dir.glob("sheet-*.jpg"), *a.report_dir.glob("crops/*.jpg")]:
        old.unlink()
    items: list[tuple[FaceClip, Any]] = []
    key = os.environ.get("PIXABAY_API_KEY", "")
    pnet = pb.UrllibNet()
    known = ([json.loads(x) for x in MANIFEST_PATH.read_text().splitlines() if x.strip()]
             if MANIFEST_PATH.exists() and a.batch > 1 else [])
    if key:
        items += pixabay_known(pnet, key, known)
        seen = [int(c.clip_id.removeprefix("pixabay_")) for c, _ in items]
        for b in range(1 if a.batch == 1 else 2, a.batch + 1):
            items += pixabay_clips(pnet, key, a.per_query, BATCHES[b], exclude=seen)
    else:
        print("PIXABAY_API_KEY is not set: no Pixabay clips", flush=True)
    items += pexels_face_clips()
    items += [(c, Path(c.path)) for c in local_sources(a.out, a.holoassist, a.egocentric)]
    xnet = px.UrllibNet()
    pkey = os.environ.get("PEXELS_API_KEY", "")

    def fetch(clip: FaceClip, src: Any) -> Path:
        if clip.source == "pixabay":
            return pb.fetch(pnet, src, a.out)
        if clip.source == "pexels":
            return px.fetch_pick(xnet, src, a.out, pkey)[0]
        return Path(src)

    clips = run(items, fetch, a.report_dir)
    (a.report_dir / "features.json").write_text(json.dumps(features_dump(clips)))
    MANIFEST_PATH.parent.mkdir(parents=True, exist_ok=True)
    MANIFEST_PATH.write_text("\n".join(manifest_lines(clips)) + "\n")
    new = None if a.batch == 1 else {c.clip_id for c in clips} - {r["clip_id"] for r in known}
    (a.report_dir / "README.md").write_text(render_sheets(clips, "", a.run))
    (a.report_dir / "comment.md").write_text(render_sheets(clips, "{IMAGE_BASE}", a.run, new))
    print((a.report_dir / "README.md").read_text())
    return 0


def local_sources(out: Path, n_holo: int, n_ego: int) -> list[FaceClip]:  # pragma: no cover
    """HoloAssist task windows and Egocentric-10K clips, cut to local files."""
    clips: list[FaceClip] = []
    if n_holo > 0:
        try:
            import httpx

            from .benchmark import holo
            from .benchmark.runner import holo_clips

            client = httpx.Client(timeout=300, follow_redirects=True)
            remote = holo.Remote(Path(os.environ.get("QUELLIX_HOLO_CACHE", out / "cache")),
                                 client)
            work = out / "holo"
            work.mkdir(parents=True, exist_ok=True)
            recs, _ = holo_clips("tasks", n_holo, work, 83, remote, client, split="train")
            seen: set[str] = set()
            for r in recs:
                session = r.clip_id.removeprefix("holo_task_").rsplit("_", 1)[0]
                if session in seen:
                    continue     # one window per session
                seen.add(session)
                clips.append(FaceClip(r.clip_id, "holoassist", r.license,
                                      "https://holoassist.github.io/", "no_face",
                                      "first-person work", session, path=r.path))
        except Exception as e:  # noqa: BLE001
            print(f"holoassist: {type(e).__name__}: {e}", flush=True)
    if n_ego > 0 and os.environ.get("HF_TOKEN"):
        try:
            from .datasets import egocentric10k
            from .datasets.manifest import load_manifest

            m = out / "ego.jsonl"
            egocentric10k.build(m, out / "ego", clips=n_ego)
            for r in load_manifest(m):
                clips.append(FaceClip(r.clip_id, "egocentric10k", r.license,
                                      "https://huggingface.co/datasets/builddotai/Egocentric-10K",
                                      "no_face", "first-person work", r.clip_id, path=r.path))
        except Exception as e:  # noqa: BLE001
            print(f"egocentric10k: {type(e).__name__}: {e}", flush=True)
    return clips


if __name__ == "__main__":  # pragma: no cover
    sys.exit(main())
