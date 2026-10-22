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

MODEL = "privacy:yunet-2023mar+ppocrv3-regions"

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

FACE_SCORE_THRESHOLD = 0.7
MIN_FACE_SHARE = 0.02  # ignore faces narrower than 2% of the frame width (far background)

# Documents / screens: a candidate is a large, filled, axis-aligned rectangle that is bright
# (paper, or a bright screen) or dark (a dark screen), with text evidence inside it.
# HEURISTIC v0: validated on generated overlays only (no labelled real footage yet).
MIN_REGION_SHARE, MAX_REGION_SHARE = 0.04, 0.70  # of the frame area
MIN_FILL = 0.80  # contour area / bounding rectangle area
BRIGHT_LEVEL, DARK_LEVEL = 170, 70  # pixel levels for the connected-region search
BRIGHT_MEAN, DARK_MEAN = 150, 90  # mean level inside an outlined rectangle
FLOOD_TOLERANCE = 25  # how far from the seed level a pixel may be and still be the same surface
MIN_TEXT_BOXES_IN_DOCUMENT = 2  # text lines found by the text detector
MIN_LINE_ROWS = 5  # or: distinct dark rows (ruled / printed lines) inside a bright rectangle
LINE_ROW_DIP = 20  # a row is a "line" when its mean is this much darker than the page


def _iou(a: tuple[int, int, int, int], b: tuple[int, int, int, int]) -> float:
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
    fractions of the frame, in [0, 1]."""

    def detect(self, rgb: np.ndarray) -> list[tuple[float, float, float, float]]: ...


class NoRegionDetector:
    def detect(self, rgb: np.ndarray) -> list[tuple[float, float, float, float]]:
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


class YuNetFaceDetector:
    def __init__(self, model_path: str | Path | None = None) -> None:
        self._path = str(model_path or yunet_path())
        self._detector: Any = None

    def detect(self, rgb: np.ndarray) -> list[tuple[float, float, float, float]]:
        h, w = rgb.shape[:2]
        if self._detector is None:
            self._detector = cv2.FaceDetectorYN.create(
                self._path, "", (w, h), FACE_SCORE_THRESHOLD, 0.3, 5000
            )
        self._detector.setInputSize((w, h))
        _, faces = self._detector.detect(cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR))
        if faces is None:
            return []
        boxes = [(float(f[0]) / w, float(f[1]) / h, float(f[2]) / w, float(f[3]) / h)
                 for f in faces]
        return [b for b in boxes if b[2] >= MIN_FACE_SHARE]


class RegionAnalyzer:
    """Documents and screens in one frame: text lines (PP-OCRv3 DB) + rectangle analysis."""

    def __init__(self, text_model: str | Path | None = None) -> None:
        self._path = str(text_model or text_model_path())
        self._text: Any = None

    def _text_boxes(self, rgb: np.ndarray) -> list[np.ndarray]:
        """Corner polygons (4 x 2, pixels) of the detected text lines."""
        if self._text is None:
            m = cv2.dnn.TextDetectionModel_DB(self._path)
            m.setBinaryThreshold(0.3)
            m.setPolygonThreshold(0.5)
            m.setMaxCandidates(200)
            m.setUnclipRatio(2.0)
            m.setInputParams(1.0 / 255, (640, 384), (122.67891434, 116.66876762, 104.00698793),
                             swapRB=True)
            self._text = m
        polygons, _ = self._text.detect(rgb)
        return [np.asarray(poly, dtype=np.float32).reshape(-1, 2) for poly in polygons]

    @staticmethod
    def _flood_regions(gray: np.ndarray, polygons: list[np.ndarray]
                       ) -> list[tuple[tuple[int, int, int, int], float]]:
        """For each text line: the uniform surface it sits on (flood fill from just outside the
        text), as (bounding rectangle, mean level). A screen or a page is bounded by its bezel
        or edge, so the fill stops there even when the room behind has a similar tone."""
        h, w = gray.shape
        out = []
        for poly in polygons:
            # seed: the pixel closest to the box's median level (the surface, not the text)
            x0, x1 = int(poly[:, 0].min()), int(poly[:, 0].max())
            y0, y1 = int(poly[:, 1].min()), int(poly[:, 1].max())
            patch = gray[max(0, y0): y1 + 1, max(0, x0): x1 + 1]
            if patch.size == 0:
                continue
            dy, dx = np.unravel_index(
                np.argmin(np.abs(patch.astype(np.int16) - int(np.median(patch)))), patch.shape)
            sx, sy = max(0, x0) + int(dx), max(0, y0) + int(dy)
            mask = np.zeros((h + 2, w + 2), np.uint8)
            cv2.floodFill(gray.copy(), mask, (sx, sy), 255,
                          loDiff=FLOOD_TOLERANCE, upDiff=FLOOD_TOLERANCE,
                          flags=4 | cv2.FLOODFILL_MASK_ONLY | cv2.FLOODFILL_FIXED_RANGE
                          | (255 << 8))
            region = mask[1:-1, 1:-1]
            x, y, cw, ch = cv2.boundingRect(region)
            area = cv2.countNonZero(region)
            if cw * ch == 0 or area / (cw * ch) < MIN_FILL:
                continue
            if MIN_REGION_SHARE <= cw * ch / (w * h) <= MAX_REGION_SHARE:
                out.append(((x, y, cw, ch), float(gray[region > 0].mean())))
        return out

    @staticmethod
    def _rectangles(gray: np.ndarray, bright: bool) -> list[tuple[int, int, int, int]]:
        """Large filled rectangles that are bright (paper, lit screen) or dark (screen), found
        two ways so neither a busy background nor a soft edge hides them: connected regions of
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
    def _line_rows(gray: np.ndarray, rect: tuple[int, int, int, int]) -> int:
        x, y, w, h = rect
        inner = gray[y + h // 20: y + h - h // 20, x + w // 20: x + w - w // 20]
        if inner.size == 0:
            return 0
        rows = inner.mean(axis=1)
        dark = rows < np.median(rows) - LINE_ROW_DIP
        return int(np.count_nonzero(dark[1:] & ~dark[:-1]) + int(dark[0]))  # runs of dark rows

    def analyze(self, rgb: np.ndarray) -> dict[str, list[tuple[float, float, float, float]]]:
        gray = cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY)
        h, w = gray.shape
        polygons = self._text_boxes(rgb)
        centres = [(float(p[:, 0].mean()), float(p[:, 1].mean())) for p in polygons]

        def inside(rect: tuple[int, int, int, int]) -> int:
            x, y, cw, ch = rect
            return sum(x <= cx <= x + cw and y <= cy <= y + ch for cx, cy in centres)

        def norm(r: tuple[int, int, int, int]) -> tuple[float, float, float, float]:
            return (r[0] / w, r[1] / h, r[2] / w, r[3] / h)

        documents = [r for r in self._rectangles(gray, bright=True)
                     if inside(r) >= MIN_TEXT_BOXES_IN_DOCUMENT
                     or self._line_rows(gray, r) >= MIN_LINE_ROWS]
        screens = [r for r in self._rectangles(gray, bright=False) if inside(r) >= 1]
        for rect, level in self._flood_regions(gray, polygons):
            if level >= BRIGHT_MEAN and inside(rect) >= MIN_TEXT_BOXES_IN_DOCUMENT:
                documents.append(rect)
            elif level <= DARK_MEAN and inside(rect) >= 1:
                screens.append(rect)
        return {"documents": [norm(r) for r in _unique(documents)],
                "screens": [norm(r) for r in _unique(screens)]}


class _Cached:
    """Runs the shared analyzer once per frame and serves one kind of region."""

    def __init__(self, analyzer: RegionAnalyzer, kind: str) -> None:
        self._analyzer, self._kind = analyzer, kind
        self._last: tuple[int, dict[str, list]] | None = None

    def detect(self, rgb: np.ndarray) -> list[tuple[float, float, float, float]]:
        key = id(rgb)
        if self._last is None or self._last[0] != key:
            self._last = (key, self._analyzer.analyze(rgb))
        return self._last[1][self._kind]


def _detections(frames, detector) -> list[dict[str, Any]]:
    out = []
    for f in frames:
        for x, y, w, h in detector.detect(f.rgb):
            out.append({"t_s": float(f.t_s), "box": [round(float(v), 4) for v in (x, y, w, h)]})
    return out


def run(
    video: DecodedVideo,
    faces: Any | None = None,
    documents: RegionDetector | None = None,
    screens: RegionDetector | None = None,
) -> CheckOutput:
    try:
        face_detector = faces or YuNetFaceDetector()
        if documents is None or screens is None:
            analyzer = RegionAnalyzer()
            documents = documents or _Cached(analyzer, "documents")
            screens = screens or _Cached(analyzer, "screens")
        result = {
            "faces": _detections(video.frames, face_detector),
            "documents": _detections(video.frames, documents),
            "screens": _detections(video.frames, screens),
        }
    except Exception as exc:  # missing weights, bad model: review, never silent pass
        return CheckOutput(error=f"privacy detector unavailable: {exc}")
    return CheckOutput(measurements=to_py(result), model=MODEL)
