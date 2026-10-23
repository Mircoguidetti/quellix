"""Privacy: faces (YuNet) and documents / screens (text detection + rectangle analysis)."""

from __future__ import annotations

import hashlib
import os
import urllib.request
from pathlib import Path
from typing import Any, Protocol

import cv2
import numpy as np

from ..jsonable import to_py
from ..media import DecodedVideo
from ..rubric import CheckOutput

MODEL = "privacy:yunet-2023mar+scale-check+ppocrv3-regions"

# Weights come from opencv_zoo, pinned to one commit and verified by sha256. They are stored in
# Git LFS and fetched on first use into QUELLIX_MODEL_DIR (default ~/.cache/quellix), or read
# from the path in the model's environment variable.
ZOO_COMMIT = "48b10fa505aeb51fbd127fc60a5c660040e823b7"
YUNET_COMMIT = ZOO_COMMIT  # kept for the pin test
YUNET_FILENAME = "face_detection_yunet_2023mar.onnx"  # MIT
YUNET_SHA256 = "8f2383e4dd3cfbb4553ea8718107fc0423210dc964f9f4280604804ed2552fa4"
TEXT_FILENAME = "text_detection_en_ppocrv3_2023may.onnx"  # PP-OCRv3 DB text detector, Apache-2.0
TEXT_SHA256 = "03f550c6b406fda8bf54bd8327815f6c7e2edd98cea02348c93d879254366587"
_ZOO_DIRS = {YUNET_FILENAME: "face_detection_yunet", TEXT_FILENAME: "text_detection_ppocr"}


def _zoo_url(filename: str) -> str:
    return (f"https://media.githubusercontent.com/media/opencv/opencv_zoo/{ZOO_COMMIT}/"
            f"models/{_ZOO_DIRS[filename]}/{filename}")


YUNET_URL = _zoo_url(YUNET_FILENAME)
TEXT_URL = _zoo_url(TEXT_FILENAME)

# --- faces -----------------------------------------------------------------------------
# YuNet reports a score per face. A face is *confident* (reported in ``faces``) from
# FACE_CONFIDENT_SCORE and FACE_CONFIDENT_SHARE of the frame width; weaker or smaller ones
# (down to FACE_MIN_SCORE / FACE_MIN_SHARE) are *possible* (``faces_possible``): in factory
# footage, small faces far in the background are coworkers at a distance, not the subject.
FACE_MIN_SCORE = 0.6
FACE_MIN_SHARE = 0.02
FACE_CONFIDENT_SCORE = 0.8
FACE_CONFIDENT_SHARE = 0.04

# A detection only counts when the same kind is seen in at least PERSIST_MIN_HITS analysed
# frames within PERSIST_WINDOW_S seconds. A single-frame hit is a flicker (a poster, a lit
# panel, a motion-blurred shape), not something that was in view. Privacy analyses every
# PRIVACY_STRIDE-th sampled frame (4 fps / 2 = 2 fps), so 2 hits mean about one second.
PRIVACY_STRIDE = 2
PERSIST_MIN_HITS = 2
PERSIST_WINDOW_S = 2.0

# Second stage for faces (#83). YuNet also fires on round textured things seen from above (a bowl
# of ground coffee with a spoon scored 0.86, as high as a real face). Such a "face" only exists at
# the size it happens to have: redrawn at other sizes, YuNet no longer finds it, while a real face
# is still found. Every face from FACE_VERIFY_FROM_SCORE and FACE_MIN_SHARE gets `verify`: the
# lowest score YuNet gives its box redrawn FACE_VERIFY_SIZES px wide. It is confident (reported)
# when `verify` >= FACE_VERIFY_MIN; otherwise it goes to `faces_possible` (recorded, not used by
# the rubric). Because a verified face is a face, the floors are lower than without the check
# (0.75 instead of FACE_CONFIDENT_SCORE, 2% of the width instead of FACE_CONFIDENT_SHARE): a
# coworker's face across the bench is caught. A face verified at FACE_SINGLE_FRAME_VERIFY or more
# counts even when seen in a single analysed frame (a real face can be in view for under a second).
# Chosen on the dev half of eval/test_sets/privacy_faces.jsonl (44 clips with a face, 123 without):
# the middle of the plateau of settings with the fewest misses and no false reject. Held-out
# results: eval/reports/privacy-faces/score.md.
FACE_VERIFY_FROM_SCORE = 0.75
FACE_VERIFY_SIZES = (40, 112)  # not smaller: a clear face shrunk to 24 px often scores < 0.5
FACE_VERIFY_MIN = 0.5
FACE_SINGLE_FRAME_VERIFY = 0.8
FACE_VERIFY_CENTRE = 0.25  # the face found in the crop must be centred within this share

# --- documents and screens ------------------------------------------------------------
# HEURISTICS, validated on overlays over real photographs (scikit-image sample images) and
# on generated frames; not yet on labelled factory footage.
MIN_REGION_SHARE, MAX_REGION_SHARE = 0.04, 0.70  # of the frame area
MIN_FILL = 0.80  # contour area / bounding rectangle area
BRIGHT_LEVEL, DARK_LEVEL = 170, 70  # pixel levels for the connected-region search
BRIGHT_MEAN, DARK_MEAN = 150, 90  # mean level inside an outlined rectangle

# A ruled / printed page: at least MIN_RULED_LINES long, thin, dark horizontal lines on a
# bright background, stacked with the same horizontal extent. Independent of what is behind it.
MIN_RULED_LINES = 6
RULE_CONTRAST = 45  # a line is this much darker than the bright page around it
RULE_PAGE_LEVEL = 160  # ... and the page level is at least this bright
MIN_RULE_SHARE = 0.06  # a line is at least this share of the frame width
# A text document found by the text detector: this many text lines inside a bright rectangle
# is a confident document, one less is a possible one.
MIN_TEXT_LINES_IN_DOCUMENT = 3
# A screen: a large, flat, dark panel (std <= PANEL_STD, level <= PANEL_LEVEL) with content,
# i.e. text found inside / around it or bright accents. Dark panels without content (a
# switched-off monitor, a window) are not reported. Text is a confident screen, accents only
# a possible one.
PANEL_LEVEL, PANEL_STD = 45, 8
MIN_SCREEN_SHARE = 0.05
PANEL_PAD = 0.7  # content is looked for in the panel grown by this much of its size
ACCENT_LEVEL, ACCENT_SHARE = 120, 0.005
MAX_OCR_CANDIDATES = 3  # per frame; the text detector only ever runs on candidate crops


def _iou(a: tuple[int, ...], b: tuple[int, ...]) -> float:
    ix = max(0, min(a[0] + a[2], b[0] + b[2]) - max(a[0], b[0]))
    iy = max(0, min(a[1] + a[3], b[1] + b[3]) - max(a[1], b[1]))
    inter = ix * iy
    return inter / max(1, a[2] * a[3] + b[2] * b[3] - inter)


def _unique(rects: list[tuple[int, int, int, int]]) -> list[tuple[int, int, int, int]]:
    """Drop near-duplicates (the same rectangle found more than one way)."""
    out: list[tuple[int, int, int, int]] = []
    for r in rects:
        if not any(_iou(r, u) > 0.6 for u in out):
            out.append(r)
    return out


class RegionDetector(Protocol):
    """Finds readable documents or screens in one RGB frame; returns boxes (x, y, w, h) as
    fractions of the frame, in [0, 1], optionally followed by a score / evidence count."""

    def detect(self, rgb: np.ndarray) -> list[tuple[float, ...]]: ...


class NoRegionDetector:
    def detect(self, rgb: np.ndarray) -> list[tuple[float, ...]]:
        return []


def model_path(filename: str, sha256: str, env_var: str) -> Path:
    explicit = os.environ.get(env_var)
    if explicit:
        return Path(explicit)
    cache = Path(os.environ.get("QUELLIX_MODEL_DIR", Path.home() / ".cache" / "quellix"))
    target = cache / filename
    if not target.exists():
        cache.mkdir(parents=True, exist_ok=True)
        tmp = target.with_suffix(".part")
        urllib.request.urlretrieve(_zoo_url(filename), tmp)  # noqa: S310 (fixed https URL)
        digest = hashlib.sha256(tmp.read_bytes()).hexdigest()
        if digest != sha256:
            tmp.unlink()
            raise RuntimeError(f"{filename} has an unexpected sha256 ({digest})")
        tmp.rename(target)
    return target


def yunet_path() -> Path:
    return model_path(YUNET_FILENAME, YUNET_SHA256, "QUELLIX_YUNET_PATH")


def text_model_path() -> Path:
    return model_path(TEXT_FILENAME, TEXT_SHA256, "QUELLIX_TEXT_MODEL_PATH")


def face_crop(rgb: np.ndarray, box: tuple[float, ...] | list[float], face_px: int) -> np.ndarray:
    """A square twice the size of ``box`` (fractions of the frame), centred on it, grey past the
    frame edge, redrawn so the box is ``face_px`` wide."""
    h, w = rgb.shape[:2]
    bw, bh = box[2] * w, box[3] * h
    side = max(1, int(round(max(bw, bh) * 2.0)))
    x0 = int(round((box[0] + box[2] / 2) * w - side / 2))
    y0 = int(round((box[1] + box[3] / 2) * h - side / 2))
    padded = cv2.copyMakeBorder(rgb, side, side, side, side, cv2.BORDER_CONSTANT,
                                value=(128, 128, 128))
    crop = padded[y0 + side:y0 + 2 * side, x0 + side:x0 + 2 * side]
    scale = face_px / max(bw, 1.0)
    size = max(16, int(round(side * scale)))
    return cv2.resize(crop, (size, size),
                      interpolation=cv2.INTER_AREA if scale < 1 else cv2.INTER_CUBIC)


class YuNetFaceDetector:
    def __init__(self, model_path: str | Path | None = None) -> None:
        self._path = str(model_path or yunet_path())
        self._detector: Any = None
        self._crop_detector: Any = None

    def crop_score(self, crop_rgb: np.ndarray) -> float:
        """YuNet's best score for a face near the centre of a crop."""
        h, w = crop_rgb.shape[:2]
        if self._crop_detector is None:
            self._crop_detector = cv2.FaceDetectorYN.create(self._path, "", (w, h), 0.05, 0.3, 50)
        self._crop_detector.setInputSize((w, h))
        _, faces = self._crop_detector.detect(cv2.cvtColor(crop_rgb, cv2.COLOR_RGB2BGR))
        best = 0.0
        for f in [] if faces is None else faces:
            cx, cy = (f[0] + f[2] / 2) / w, (f[1] + f[3] / 2) / h
            if abs(cx - 0.5) <= FACE_VERIFY_CENTRE and abs(cy - 0.5) <= FACE_VERIFY_CENTRE:
                best = max(best, float(f[-1]))
        return best

    def verify(self, rgb: np.ndarray, box: tuple[float, ...]) -> float:
        """The lowest crop score over FACE_VERIFY_SIZES: high only for a face that is still a
        face at other sizes."""
        return min(self.crop_score(face_crop(rgb, box, px)) for px in FACE_VERIFY_SIZES)

    def detect(self, rgb: np.ndarray) -> list[tuple[float, ...]]:
        """(x, y, w, h, score[, verify]) per face; ``verify`` for faces from
        FACE_VERIFY_FROM_SCORE (the only ones it can make confident)."""
        h, w = rgb.shape[:2]
        if self._detector is None:
            self._detector = cv2.FaceDetectorYN.create(
                self._path, "", (w, h), FACE_MIN_SCORE, 0.3, 5000
            )
        self._detector.setInputSize((w, h))
        _, faces = self._detector.detect(cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR))
        if faces is None:
            return []
        boxes = [(float(f[0]) / w, float(f[1]) / h, float(f[2]) / w, float(f[3]) / h,
                  float(f[-1])) for f in faces]  # last column of YuNet's output is the score
        out: list[tuple[float, ...]] = []
        for b in boxes:
            if b[2] < FACE_MIN_SHARE:
                continue
            if b[4] >= FACE_VERIFY_FROM_SCORE:
                b = (*b, self.verify(rgb, b))
            out.append(b)
        return out


class RegionAnalyzer:
    """Documents and screens in one frame: structure first (cheap), the text detector only on
    candidate crops, never on the whole frame."""

    def __init__(self, text_model: str | Path | None = None) -> None:
        self._path = str(text_model or text_model_path())
        self._text: Any = None

    def _text_lines(self, rgb: np.ndarray) -> list[np.ndarray]:
        """Corner polygons (n x 2, pixels of ``rgb``) of the text lines in an image crop."""
        if self._text is None:
            m = cv2.dnn.TextDetectionModel_DB(self._path)
            m.setBinaryThreshold(0.3)
            m.setPolygonThreshold(0.5)
            m.setMaxCandidates(200)
            m.setUnclipRatio(2.0)
            self._text = m
        h, w = rgb.shape[:2]
        # Text in a 480 px frame is only ~8-10 px tall, below what the text detector sees
        # (it needs ~12 px): crops are upscaled by 1.5, capped at 800 px on the long side.
        scale = min(1.5, 800 / max(h, w))
        iw = max(64, int(round(w * scale / 32)) * 32)
        ih = max(64, int(round(h * scale / 32)) * 32)
        self._text.setInputParams(1.0 / 255, (iw, ih), (122.67891434, 116.66876762, 104.00698793),
                                  swapRB=True)
        polygons, _ = self._text.detect(rgb)
        return [np.asarray(poly, dtype=np.float32).reshape(-1, 2) for poly in polygons]

    def _text_in(self, rgb: np.ndarray, rect: tuple[int, int, int, int],
                 pad: float = 0.1) -> int:
        """Text lines inside ``rect`` (grown by ``pad``), found on that crop only."""
        h, w = rgb.shape[:2]
        x, y, cw, ch = rect
        dx, dy = int(cw * pad), int(ch * pad)
        x0, y0 = max(0, x - dx), max(0, y - dy)
        x1, y1 = min(w, x + cw + dx), min(h, y + ch + dy)
        if x1 - x0 < 16 or y1 - y0 < 16:
            return 0
        return len(self._text_lines(np.ascontiguousarray(rgb[y0:y1, x0:x1])))

    @staticmethod
    def _rectangles(gray: np.ndarray, bright: bool) -> list[tuple[int, int, int, int]]:
        """Large filled rectangles that are bright (paper, lit screen) or dark, found two
        ways so neither a busy background nor a soft edge hides them: connected regions of
        the bright/dark mask, and four-sided outlines found from edges."""
        h, w = gray.shape
        found: list[tuple[int, int, int, int]] = []

        def keep(x: int, y: int, cw: int, ch: int) -> None:
            if MIN_REGION_SHARE <= cw * ch / (w * h) <= MAX_REGION_SHARE:
                found.append((x, y, cw, ch))

        mask = (gray >= BRIGHT_LEVEL) if bright else (gray <= DARK_LEVEL)
        mask = cv2.morphologyEx(mask.astype(np.uint8) * 255, cv2.MORPH_CLOSE,
                                np.ones((5, 5), np.uint8))
        contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        for c in contours:
            x, y, cw, ch = cv2.boundingRect(c)
            if cv2.contourArea(c) / max(1, cw * ch) >= MIN_FILL:
                keep(x, y, cw, ch)

        edges = cv2.dilate(cv2.Canny(cv2.GaussianBlur(gray, (3, 3), 0), 60, 140),
                           np.ones((3, 3), np.uint8))
        contours, _ = cv2.findContours(edges, cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)
        for c in contours:
            poly = cv2.approxPolyDP(c, 0.02 * cv2.arcLength(c, True), True)
            x, y, cw, ch = cv2.boundingRect(poly)
            if len(poly) != 4 or not cv2.isContourConvex(poly):
                continue
            if cv2.contourArea(poly) / max(1, cw * ch) < MIN_FILL:
                continue
            inner = gray[y + 2: y + ch - 2, x + 2: x + cw - 2]
            if inner.size and ((inner.mean() >= BRIGHT_MEAN) if bright
                               else (inner.mean() <= DARK_MEAN)):
                keep(x, y, cw, ch)
        return _unique(found)

    @staticmethod
    def ruled_pages(gray: np.ndarray) -> list[tuple[int, int, int, int, int]]:
        """Stacks of long thin dark horizontal lines on a bright page: (x, y, w, h, n_lines)."""
        h, w = gray.shape
        close = cv2.morphologyEx(gray, cv2.MORPH_CLOSE, np.ones((7, 1), np.uint8))
        mask = ((cv2.subtract(close, gray) >= RULE_CONTRAST) & (close >= RULE_PAGE_LEVEL))
        mask = cv2.morphologyEx(mask.astype(np.uint8) * 255, cv2.MORPH_OPEN,
                                np.ones((1, max(9, int(w * MIN_RULE_SHARE))), np.uint8))
        n, _, stats, _ = cv2.connectedComponentsWithStats(mask, connectivity=8)
        lines = [tuple(int(v) for v in stats[i][:4]) for i in range(1, n)
                 if stats[i][3] <= 5 and stats[i][2] >= w * MIN_RULE_SHARE * 1.3]
        groups: list[dict[str, Any]] = []
        for x, y, cw, ch in sorted(lines, key=lambda r: r[1]):
            for g in groups:
                if (abs(x - g["x"]) <= 0.04 * w and abs(x + cw - g["x1"]) <= 0.04 * w
                        and y - g["ys"][-1] <= 0.12 * h):
                    g["ys"].append(y)
                    g["y1"] = max(g["y1"], y + ch)
                    break
            else:
                groups.append({"x": x, "x1": x + cw, "ys": [y], "y1": y + ch})
        return [(g["x"], g["ys"][0], g["x1"] - g["x"], g["y1"] - g["ys"][0], len(g["ys"]))
                for g in groups if len(g["ys"]) >= MIN_RULED_LINES]

    @staticmethod
    def dark_panels(gray: np.ndarray) -> list[tuple[int, int, int, int]]:
        """Large flat dark rectangles (std <= PANEL_STD): screens, or just dark surfaces."""
        h, w = gray.shape
        f = gray.astype(np.float32)
        mean = cv2.blur(f, (5, 5))
        std = np.sqrt(np.maximum(cv2.blur(f * f, (5, 5)) - mean * mean, 0))
        mask = ((gray <= PANEL_LEVEL) & (std <= PANEL_STD)).astype(np.uint8) * 255
        mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, np.ones((7, 7), np.uint8))
        mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, np.ones((5, 5), np.uint8))
        contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        out = []
        for c in contours:
            x, y, cw, ch = cv2.boundingRect(c)
            if (MIN_SCREEN_SHARE <= cw * ch / (w * h) <= MAX_REGION_SHARE
                    and cv2.contourArea(c) / max(1, cw * ch) >= MIN_FILL):
                out.append((x, y, cw, ch))
        return out

    def analyze(self, rgb: np.ndarray) -> dict[str, list[tuple[float, ...]]]:
        """-> {"documents": [(x, y, w, h, evidence)], "screens": [...]}, boxes as frame
        fractions; evidence = number of text / ruled lines (0.5 = bright accents only)."""
        gray = cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY)
        h, w = gray.shape

        def norm(r: tuple[int, ...], ev: float) -> tuple[float, ...]:
            return (r[0] / w, r[1] / h, r[2] / w, r[3] / h, float(ev))

        documents: list[tuple[float, ...]] = []
        screens: list[tuple[float, ...]] = []

        ruled = self.ruled_pages(gray)
        for x, y, cw, ch, n_lines in ruled:
            documents.append(norm((x, y, cw, ch), n_lines))

        budget = MAX_OCR_CANDIDATES
        panels = sorted(self.dark_panels(gray), key=lambda r: -r[2] * r[3])
        for rect in panels:
            x, y, cw, ch = rect
            grown = (max(0, int(x - PANEL_PAD * cw)), max(0, int(y - PANEL_PAD * ch)),
                     int(cw * (1 + 2 * PANEL_PAD)), int(ch * (1 + 2 * PANEL_PAD)))
            gx, gy, gw, gh = grown
            region = gray[gy:gy + gh, gx:gx + gw]
            accents = float((region >= ACCENT_LEVEL).mean()) >= ACCENT_SHARE
            lines = 0
            if budget > 0:
                budget -= 1
                lines = self._text_in(rgb, grown, pad=0.0)
            if lines >= 1:
                screens.append(norm(rect, lines))
            elif accents:
                screens.append(norm(rect, 0.5))

        # Text documents on a bright rectangle that is not already a ruled page.
        for rect in sorted(self._rectangles(gray, bright=True), key=lambda r: -r[2] * r[3]):
            if budget <= 0:
                break
            if any(_iou(rect, (r[0], r[1], r[2], r[3])) > 0.3 for r in ruled):
                continue
            budget -= 1
            lines = self._text_in(rgb, rect)
            if lines >= MIN_TEXT_LINES_IN_DOCUMENT - 1:
                documents.append(norm(rect, lines))
        return {"documents": documents, "screens": screens}


class _Cached:
    """Runs the shared analyzer once per frame and serves one kind of region."""

    def __init__(self, analyzer: RegionAnalyzer, kind: str) -> None:
        self._analyzer, self._kind = analyzer, kind
        self._last: tuple[int, dict[str, list]] | None = None

    def detect(self, rgb: np.ndarray) -> list[tuple[float, ...]]:
        key = id(rgb)
        if self._last is None or self._last[0] != key:
            self._last = (key, self._analyzer.analyze(rgb))
        return self._last[1][self._kind]


def _detections(frames, detector) -> list[dict[str, Any]]:
    """Raw per-frame detections: {t_s, box, score?}."""
    out = []
    for f in frames:
        for det in detector.detect(f.rgb):
            d: dict[str, Any] = {"t_s": float(f.t_s),
                                 "box": [round(float(v), 4) for v in det[:4]]}
            if len(det) > 4:
                d["score"] = round(float(det[4]), 4)
            if len(det) > 5 and det[5] is not None:
                d["verify"] = round(float(det[5]), 4)
            out.append(d)
    return out


def persistent(detections: list[dict[str, Any]], min_hits: int = PERSIST_MIN_HITS,
               window_s: float = PERSIST_WINDOW_S) -> list[dict[str, Any]]:
    """Keep detections that belong to a run of at least ``min_hits`` distinct sampled frames
    within ``window_s`` seconds; a lone hit is a flicker."""
    times = sorted({d["t_s"] for d in detections})
    keep: set[float] = set()
    for i, t in enumerate(times):
        window = [u for u in times[i:] if u - t <= window_s]
        if len(window) >= min_hits:
            keep.update(window)
    return [d for d in detections if d["t_s"] in keep]


def _save_debug_frames(frames, kind: str, detections: list[dict[str, Any]], label: str) -> None:
    """With QUELLIX_DEBUG_FRAMES_DIR set, write each reported detection as an annotated JPEG
    (``<label>__<kind>__<t>.jpg``) so what is being flagged can be looked at (eval contact
    sheet). Never part of the decision; failures are ignored."""
    out_dir = os.environ.get("QUELLIX_DEBUG_FRAMES_DIR")
    if not out_dir or not detections:
        return
    try:
        by_t = {round(f.t_s, 3): f for f in frames}
        Path(out_dir).mkdir(parents=True, exist_ok=True)
        done: set[float] = set()
        for d in detections:
            f = by_t.get(round(d["t_s"], 3))
            if f is None or d["t_s"] in done:
                continue
            done.add(d["t_s"])
            img = cv2.cvtColor(f.rgb, cv2.COLOR_RGB2BGR)
            h, w = img.shape[:2]
            for dd in (x for x in detections if x["t_s"] == d["t_s"]):
                x0, y0 = int(dd["box"][0] * w), int(dd["box"][1] * h)
                x1, y1 = x0 + int(dd["box"][2] * w), y0 + int(dd["box"][3] * h)
                cv2.rectangle(img, (x0, y0), (x1, y1), (0, 0, 255), 2)
                cv2.putText(img, f"{kind} {dd.get('score', '')}", (x0, max(12, y0 - 4)),
                            cv2.FONT_HERSHEY_SIMPLEX, 0.45, (0, 0, 255), 1)
            safe = "".join(c if c.isalnum() or c in "-_" else "_" for c in label)
            cv2.imwrite(str(Path(out_dir) / f"{safe}__{kind}__{d['t_s']:.1f}.jpg"), img)
    except Exception:  # debugging aids must never break the check
        return


def _is_confident(kind: str, det: dict[str, Any]) -> bool:
    """Confident detections go to the rubric's ``faces`` / ``documents`` / ``screens``;
    weaker ones to ``<kind>_possible``. A detector that gives no score is confident."""
    score = det.get("score")
    if score is None:
        return True
    if kind == "faces":
        if "verify" in det:  # the second stage ran (#83)
            return (score >= FACE_VERIFY_FROM_SCORE and det["box"][2] >= FACE_MIN_SHARE
                    and det["verify"] >= FACE_VERIFY_MIN)
        return score >= FACE_CONFIDENT_SCORE and det["box"][2] >= FACE_CONFIDENT_SHARE
    if kind == "documents":
        return score >= MIN_TEXT_LINES_IN_DOCUMENT
    return score >= 1.0  # screens: text found (0.5 = bright accents only)


def run(
    video: DecodedVideo,
    faces: Any | None = None,
    documents: RegionDetector | None = None,
    screens: RegionDetector | None = None,
    label: str = "video",
) -> CheckOutput:
    try:
        face_detector = faces or YuNetFaceDetector()
        if documents is None or screens is None:
            analyzer = RegionAnalyzer()
            documents = documents or _Cached(analyzer, "documents")
            screens = screens or _Cached(analyzer, "screens")
        frames = video.frames[::PRIVACY_STRIDE]  # privacy does not need every sampled frame
        result: dict[str, list[dict[str, Any]]] = {}
        for kind, detector in (("faces", face_detector), ("documents", documents),
                               ("screens", screens)):
            raw = _detections(frames, detector)
            confident = [d for d in raw if _is_confident(kind, d)]
            kept = persistent(confident)
            # a clearly verified face counts on a single frame (#83)
            result[kind] = [d for d in confident if any(d is k for k in kept)
                            or d.get("verify", 0.0) >= FACE_SINGLE_FRAME_VERIFY]
            result[f"{kind}_possible"] = persistent(
                [d for d in raw if not _is_confident(kind, d)])
        for kind, found in result.items():
            _save_debug_frames(frames, kind, found, label)
    except Exception as exc:  # missing weights, bad model: review, never silent pass
        return CheckOutput(error=f"privacy detector unavailable: {exc}")
    return CheckOutput(measurements=to_py(result), model=MODEL)
