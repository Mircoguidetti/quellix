"""Landing hero video candidates (#84): Pixabay search + the founder's Pexels picks.

    python -m quellix_eval.hero --out out/hero --sheets reports/hero-candidates \\
        --jsonl test_sets/hero_candidates.jsonl --final-dir out/hero/final

1. Search Pixabay (official API, `PIXABAY_API_KEY`) with QUERIES; keep landscape clips of
   10-60 s whose largest rendition is at least 1920 px wide.
2. Filter every candidate (the Pexels picks too) with what the worker already has: both hands
   fully visible in at least MIN_BOTH_HANDS of the frames (the real hands model), no confident
   face (the privacy check's YuNet), blur ratio at most MAX_BLUR (the technical check), and a
   viewpoint of first_person or uncertain (the #79 check; see `viewpoint_probe`).
3. Write a 2x2 contact sheet per survivor and per Pexels pick, and one JSONL line per candidate.
4. Run the Pexels picks through the site-clips pipeline (best 9 s window, mp4 + webm + poster +
   sidecar; for landscape clips the steadiest good window) and record the worker's decision on
   the delivered cut. Videos are never committed; only sheets, posters and the JSONL.
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import urllib.parse
from collections.abc import Callable, Sequence
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any

import cv2
import numpy as np

QUERIES = (
    "pour over coffee", "pour over coffee top view", "kneading dough", "kneading dough top view",
    "folding shirt", "plating food", "plating food overhead", "slicing fruit cutting board",
    "cutting fruit top view", "arranging flowers", "making tea", "making tea pov",
    "rolling pasta", "pasta dough hands", "pov hands kitchen", "first person cooking",
    "overhead hands table", "top view hands wooden table",
    # run 2 (run 1 found 1 survivor in 80: most hits show no two hands): hand-centred queries
    "hands kneading", "hands cutting vegetables top view", "hands chopping board",
    "baking hands", "barista hands", "chef hands plating", "hands preparing food",
    "hands making bread", "hands rolling dough", "hands pouring coffee", "hands tea ceremony",
    "hands folding cloth", "hands arranging flowers", "hands writing desk top view",
)
API = "https://pixabay.com/api/videos/"
PIXABAY_LICENSE = "Pixabay Content License"
MIN_WIDTH = 1920
MIN_DURATION_S, MAX_DURATION_S = 10.0, 60.0
MIN_BOTH_HANDS = 0.60
MAX_BLUR = 0.10               # the site-clips limit (site_clips.MAX_BLUR_RATIO)
FACE_MIN_SCORE = 0.9          # a "confident" face
FACE_MIN_FRAMES = 2           # ... seen in at least this many analysed frames
KEEP_VIEWPOINTS = ("first_person", "uncertain", "not measured")
MAX_SURVIVORS = 30
NEAR_MISS_HANDS = 0.30        # shown when too few survive: everything passes but hands are 30-60%
MIN_SHOWN = 20


@dataclass(frozen=True)
class Hit:
    source: str               # "pixabay" | "pexels"
    source_id: int
    page: str
    author: str
    tags: str
    duration_s: float
    width: int                # the largest rendition
    height: int
    url: str                  # the rendition downloaded for analysis
    query: str = ""

    @property
    def clip_id(self) -> str:
        return f"{self.source}_{self.source_id}"


def search_url(key: str, query: str, per_page: int = 50) -> str:
    q = urllib.parse.urlencode({"key": key, "q": query[:100], "video_type": "film",
                                "min_width": MIN_WIDTH, "per_page": max(3, min(per_page, 200)),
                                "safesearch": "true"})
    return f"{API}?{q}"


def parse_hits(raw: bytes | str, query: str) -> list[Hit]:
    """Pixabay hits that can be a desktop hero: landscape, 10-60 s, largest rendition >= 1920 px.
    The analysis copy is the 'medium' rendition (~1280 px) when it exists."""
    out = []
    for h in json.loads(raw).get("hits", []):
        videos = h.get("videos") or {}
        sizes = [(int(v.get("width") or 0), int(v.get("height") or 0), name)
                 for name, v in videos.items() if v and v.get("url")]
        if not sizes:
            continue
        w, hgt, _ = max(sizes)
        dur = float(h.get("duration") or 0)
        if w < MIN_WIDTH or w <= hgt or not MIN_DURATION_S <= dur <= MAX_DURATION_S:
            continue
        name = next((n for n in ("medium", "large", "small") if videos.get(n, {}).get("url")),
                    max(sizes)[2])
        out.append(Hit("pixabay", int(h["id"]), str(h.get("pageURL") or ""),
                       str(h.get("user") or ""), str(h.get("tags") or ""), dur, w, hgt,
                       str(videos[name]["url"]), query))
    return out


def search(get: Callable[[str], bytes], key: str, queries: Sequence[str] = QUERIES,
           per_query: int = 5, limit: int = 80) -> list[Hit]:
    """Up to `per_query` new hits per query, in query order, de-duplicated, at most `limit`."""
    seen: set[int] = set()
    out: list[Hit] = []
    for q in queries:
        taken = 0
        for hit in parse_hits(get(search_url(key, q, per_page=max(50, per_query * 4))), q):
            if hit.source_id in seen or taken >= per_query or len(out) >= limit:
                continue
            seen.add(hit.source_id)
            out.append(hit)
            taken += 1
    return out


# --- measurements and the filter ---------------------------------------------------------


@dataclass
class Measured:
    both_hands_whole: float | None = None
    confident_faces: int = 0
    blur_ratio: float | None = None
    viewpoint: str = "not measured"
    first_person_ratio: float | None = None
    viewpoint_note: str = ""
    error: str = ""


def verdict(m: Measured) -> str | None:
    """None if the candidate survives, else the first filter that drops it (in issue order)."""
    if m.error:
        return f"not analysed: {m.error}"
    if m.both_hands_whole is None or m.both_hands_whole < MIN_BOTH_HANDS:
        return f"both hands visible {_pct(m.both_hands_whole)} < {MIN_BOTH_HANDS:.0%}"
    if m.confident_faces >= FACE_MIN_FRAMES:
        return f"a face in view ({m.confident_faces} frames)"
    if m.viewpoint not in KEEP_VIEWPOINTS:
        return f"viewpoint {m.viewpoint}"
    if m.blur_ratio is not None and m.blur_ratio > MAX_BLUR:
        return f"blurry ({m.blur_ratio:.0%} of frames)"
    return None


def drop_category(result: str) -> str:
    """'dropped: both hands visible 40% < 60%' -> 'hands', and so on (for the summary line)."""
    why = result.removeprefix("dropped: ")
    for prefix, cat in (("both hands", "hands"), ("a face", "face"), ("viewpoint", "viewpoint"),
                        ("blurry", "blur"), ("not analysed", "not analysed")):
        if why.startswith(prefix):
            return cat
    return "other"


def _pct(x: float | None) -> str:
    return "n/a" if x is None else f"{x:.0%}"


def confident_faces(detections_per_frame: Sequence[Sequence[Sequence[float]]]) -> int:
    """Frames with at least one face box whose score (last value) is >= FACE_MIN_SCORE."""
    return sum(1 for boxes in detections_per_frame
               if any(b and float(b[-1]) >= FACE_MIN_SCORE for b in boxes))


def measure(  # pragma: no cover - models
    path: Path, viewpoint: Callable[[Path], dict[str, Any]]
) -> Measured:
    """The worker's own decode, hands model, face detector and blur check on one file."""
    from quellix_hands.model import HandsModel
    from quellix_worker import media
    from quellix_worker.checks import technical
    from quellix_worker.checks.privacy import YuNetFaceDetector

    m = Measured()
    try:
        v = media.decode(path)
        if not v.info.decodable or not v.frames:
            m.error = "not decodable"
            return m
        hm = _hands_model(HandsModel)
        meas = hm.measure([f.rgb for f in v.frames], [f.t_s for f in v.frames])
        m.both_hands_whole = meas.get("ratio_both_whole")
        det = _faces(YuNetFaceDetector)
        m.confident_faces = confident_faces([det.detect(f.rgb) for f in v.frames[::2]])
        tech = technical.run(v).measurements or {}
        m.blur_ratio = tech.get("blur_ratio")
    except Exception as e:  # noqa: BLE001 - one broken clip must not stop the run
        m.error = f"{type(e).__name__}: {e}"[:200]
        return m
    vp = viewpoint(path)
    m.viewpoint = str(vp.get("viewpoint") or "not measured")
    m.first_person_ratio = vp.get("first_person_ratio")
    m.viewpoint_note = str(vp.get("note") or vp.get("uncertain_why") or "")
    return m


_CACHE: dict[str, Any] = {}


def _hands_model(cls: Any) -> Any:  # pragma: no cover
    return _CACHE.setdefault("hands", cls())


def _faces(cls: Any) -> Any:  # pragma: no cover
    return _CACHE.setdefault("faces", cls())


def viewpoint_probe(path: Path, src: str | None = None,
                    run: Callable[..., Any] = subprocess.run) -> dict[str, Any]:
    """Run the #79 viewpoint check on one file in a child process (the worker's own code, merged
    in #80). `src` (or $QUELLIX_VIEWPOINT_SRC), when set, is another worker `src/` to put first on
    PYTHONPATH. Any failure -> {"viewpoint": "not measured", "note": ...}."""
    src = src if src is not None else os.environ.get("QUELLIX_VIEWPOINT_SRC", "")
    env = dict(os.environ)
    if src:      # only to test unmerged worker code; the installed worker has it since #80
        env["PYTHONPATH"] = os.pathsep.join(p for p in (src, os.environ.get("PYTHONPATH", ""))
                                            if p)
    try:
        proc = run([sys.executable, "-m", "quellix_eval.hero", "viewpoint", str(path)],
                   capture_output=True, text=True, env=env, timeout=600)
        if proc.returncode != 0:
            return {"viewpoint": "not measured", "note": (proc.stderr or "")[-200:]}
        return json.loads(proc.stdout.strip().splitlines()[-1])
    except Exception as e:  # noqa: BLE001
        return {"viewpoint": "not measured", "note": f"{type(e).__name__}: {e}"[:200]}


def _viewpoint_child(path: Path) -> int:  # pragma: no cover - runs with the #80 worker code
    from quellix_hands.model import HandsModel
    from quellix_worker import media
    from quellix_worker.checks import privacy, viewpoint
    from quellix_worker.checks.privacy import YuNetFaceDetector

    v = media.decode(path)
    per_frame = HandsModel().frames([f.rgb for f in v.frames], [f.t_s for f in v.frames])
    priv = privacy.run(v, faces=YuNetFaceDetector())
    out = viewpoint.run(v, per_frame, priv)
    print(json.dumps(out.measurements if out.measurements is not None
                     else {"viewpoint": "not measured", "note": out.error}))
    return 0


# --- contact sheets ----------------------------------------------------------------------


def sheet_frames(path: Path, n: int = 4) -> list[np.ndarray]:
    """n frames evenly spread over the clip (RGB)."""
    from .site_clips import iter_frames, video_info

    dur = video_info(path)[0]
    out = []
    for k in range(n):
        t = dur * (k + 0.5) / n
        got = next(iter_frames(path, 1.0, t, t + 1.0, max_width=640), None)
        if got is not None:
            out.append(got[1])
    return out


def contact_sheet(frames: Sequence[np.ndarray], title: str, dst: Path, cell_w: int = 480) -> None:
    """2x2 grid (any orientation), a title bar on top, JPEG."""
    if not frames:
        raise ValueError("no frames")
    h0, w0 = frames[0].shape[:2]
    cell_h = int(round(cell_w * h0 / w0))
    cells = [cv2.resize(f, (cell_w, cell_h), interpolation=cv2.INTER_AREA) for f in frames[:4]]
    while len(cells) < 4:
        cells.append(np.zeros_like(cells[0]))
    grid = np.vstack([np.hstack(cells[:2]), np.hstack(cells[2:])])
    bar = np.full((40, grid.shape[1], 3), 11, dtype=np.uint8)
    cv2.putText(bar, title[:110], (10, 27), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (235, 235, 235), 1,
                cv2.LINE_AA)
    img = np.vstack([bar, grid])
    dst.parent.mkdir(parents=True, exist_ok=True)
    cv2.imwrite(str(dst), cv2.cvtColor(img, cv2.COLOR_RGB2BGR), [cv2.IMWRITE_JPEG_QUALITY, 82])


def sheet_title(hit: Hit, m: Measured) -> str:
    vp = m.viewpoint + (f" {m.first_person_ratio:.2f}" if m.first_person_ratio is not None else "")
    return (f"{hit.clip_id}  {hit.width}x{hit.height}  {hit.duration_s:.0f}s  "
            f"hands {_pct(m.both_hands_whole)}  blur {_pct(m.blur_ratio)}  {vp}")


# --- steadiest window (site-clips) -------------------------------------------------------


def steadiest_window(per_frame: Sequence[Any], sharpness: Sequence[float], window_s: float,
                     keep: float = 0.9) -> tuple[float, float] | None:
    """Among windows whose hand score is within `keep` of the best one, the one whose
    sharpness (mean Laplacian variance of its frames) is highest: kneading moves fast, and a
    hero must not smear. `per_frame` and `sharpness` share timestamps (per_frame[i].t_s)."""
    from .site_clips import frame_flags

    if len(per_frame) < 2:
        return None
    ts = [f.t_s for f in per_frame]
    flags = [frame_flags(f) for f in per_frame]
    options = []
    j = 0
    for i, t0 in enumerate(ts):
        while j < len(ts) and ts[j] <= t0 + window_s + 1e-6:
            j += 1
        if ts[j - 1] - t0 < window_s * 0.9:
            break
        chunk = flags[i:j]
        score = 0.7 * sum(b for _, b in chunk) / len(chunk) + 0.3 * sum(
            a for a, _ in chunk) / len(chunk)
        options.append((score, float(np.mean(sharpness[i:j])), t0, min(t0 + window_s, ts[j - 1])))
    if not options:
        return None
    best = max(o[0] for o in options)
    good = [o for o in options if o[0] >= keep * best]
    _, _, a, b = max(good, key=lambda o: o[1])
    return a, b


# --- records -----------------------------------------------------------------------------


@dataclass
class Record:
    clip_id: str
    source: str
    page_url: str
    license: str
    author: str
    width: int
    height: int
    duration_s: float
    query: str
    measurements: dict[str, Any]
    result: str                       # "candidate" or "dropped: <why>"
    sheet: str | None = None
    site_clip: dict[str, Any] = field(default_factory=dict)


def record_for(hit: Hit, m: Measured, sheet: str | None, license_: str) -> Record:
    why = verdict(m)
    return Record(hit.clip_id, hit.source, hit.page, license_, hit.author, hit.width, hit.height,
                  round(hit.duration_s, 2), hit.query,
                  {k: v for k, v in asdict(m).items() if v not in ("", None)},
                  "candidate" if why is None else f"dropped: {why}", sheet)


def write_jsonl(records: Sequence[Record], path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("".join(json.dumps(asdict(r), ensure_ascii=False) + "\n" for r in records))


def near_misses(records: Sequence[Record], n: int) -> list[Record]:
    """Pixabay clips dropped only for hands between NEAR_MISS_HANDS and MIN_BOTH_HANDS (every
    other filter passed), best first: shown, clearly marked, when too few clips survive."""
    def only_hands(r: Record) -> bool:
        m = r.measurements
        return (r.result.startswith("dropped: both hands") and not m.get("error")
                and (m.get("both_hands_whole") or 0.0) >= NEAR_MISS_HANDS
                and m.get("confident_faces", 0) < FACE_MIN_FRAMES
                and m.get("viewpoint", "not measured") in KEEP_VIEWPOINTS
                and (m.get("blur_ratio") or 0.0) <= MAX_BLUR)

    ok = [r for r in records if r.source == "pixabay" and only_hands(r)]
    return sorted(ok, key=lambda r: -(r.measurements.get("both_hands_whole") or 0.0))[:max(0, n)]


def survivors(records: Sequence[Record], n: int = MAX_SURVIVORS) -> list[Record]:
    """Pixabay candidates that passed every filter, best hands ratio first, at most n."""
    ok = [r for r in records if r.source == "pixabay" and r.result == "candidate"]
    return sorted(ok, key=lambda r: -(r.measurements.get("both_hands_whole") or 0.0))[:n]


# --- the founder's Pexels picks through the site-clips pipeline --------------------------


def founder_picks() -> tuple[Any, ...]:
    from .datasets.pexels import Pick

    return (
        Pick(15157114, "a-person-kneading-a-dough-on-the-table", "Kneading dough", "landscape",
             "desktop hero candidate (founder)"),
        Pick(11142458, "hands-cutting-lemon", "Cutting lemons on a wooden board", "portrait",
             "mobile hero candidate (founder)"),
    )


def window_stats(per_frame: Sequence[Any], a: float, b: float) -> tuple[float, float]:
    """(both hands fully visible share, working share) inside [a, b]."""
    from .site_clips import frame_flags

    flags = [frame_flags(f) for f in per_frame if a <= f.t_s <= b]
    if not flags:
        return 0.0, 0.0
    return (sum(x for x, _ in flags) / len(flags), sum(y for _, y in flags) / len(flags))


def site_clip(  # pragma: no cover - models, encoding
    item: Any, hands: Any, worker: Any, rubric: Path, final_dir: Path, sheets: Path,
    viewpoint: Callable[[Path], dict[str, Any]],
) -> dict[str, Any]:
    """Best 9 s window (landscape: the steadiest good one), encode, and the worker's verdict on
    the delivered cut, with the poster copied next to the contact sheets."""
    import shutil

    from . import site_clips as sc

    cand = sc.analyse(item.clip_id, item.path, hands, worker, rubric, source=item.source)
    if cand.window is None:
        return {"error": "no 9 s window with hands (hands model found too few frames)"}
    note = "best hands window"
    if item.source.orientation == "landscape":
        samples = list(sc.iter_frames(item.path, sc.SCORE_FPS))
        per_frame = hands.frames([f for _, f in samples], [t for t, _ in samples])
        sharp = [float(cv2.Laplacian(cv2.cvtColor(f, cv2.COLOR_RGB2GRAY), cv2.CV_64F).var())
                 for _, f in samples]
        steady = steadiest_window(per_frame, sharp, sc.WINDOW_S)
        if steady is not None:
            a, b = steady
            both, working = window_stats(per_frame, a, b)
            cand.window = sc.Window(a, b, both, working, 0.7 * working + 0.3 * both)
            note = "steadiest good window (sharpest frames among windows within 90% of the best "
            note += "hands score)"
    name = item.clip_id
    files = sc.render_clip(cand, name, final_dir)
    mp4 = final_dir / files["mp4"]
    decision = worker(mp4, rubric) or {}
    side = sc.build_sidecar(cand, name, files, hands, decision, mp4)
    (final_dir / f"{name}.json").write_text(json.dumps(side, separators=(",", ":")))
    poster = sheets / f"{name}-poster.jpg"
    shutil.copy(final_dir / files["poster"], poster)
    checks = decision.get("checks", {})
    meas = {k: (checks.get(k) or {}).get("measurements") or {} for k in checks}
    vp = viewpoint(mp4)
    return {
        "window_s": [round(cand.window.start_s, 2), round(cand.window.end_s, 2)],
        "window_choice": note,
        "both_hands_whole_in_window": round(cand.window.both_full, 3),
        "decision": decision.get("decision"),
        "reasons": [{k: r.get(k) for k in ("check", "code", "effect", "message")}
                    for r in decision.get("reasons", [])],
        "statuses": {k: (v or {}).get("status") for k, v in checks.items()},
        "hands_ratio_both_manipulation": meas.get("hands_visible", {}).get(
            "ratio_both_manipulation"),
        "blur_ratio": meas.get("technical", {}).get("blur_ratio"),
        "faces": len(meas.get("privacy", {}).get("faces") or []),
        "viewpoint": vp.get("viewpoint"), "first_person_ratio": vp.get("first_person_ratio"),
        "poster": poster.name, "bytes": files["bytes"],
    }


# --- the comment ---------------------------------------------------------------------------


def comment(records: Sequence[Record], top: Sequence[Record], image_base: str,
            stats: dict[str, Any], near: Sequence[Record] = ()) -> str:
    def img(name: str | None, alt: str) -> str:
        return f"![{alt}]({image_base.rstrip('/')}/{name})" if name else "(no sheet)"

    lines = ["## Hero candidates (#84)", "",
             f"Pixabay: {stats.get('searched', 0)} hits searched, {stats.get('pixabay', 0)} "
             f"analysed, **{len(top)} candidates** shown (at most {MAX_SURVIVORS}, best hands "
             "ratio first). Filters: both hands fully visible >= 60%, no confident face, "
             "viewpoint first_person or uncertain (#79), blur <= 10%. "
             + str(stats.get("note", "")), ""]
    dropped: dict[str, int] = {}
    for r in records:
        if r.source == "pixabay" and r.result.startswith("dropped"):
            key = drop_category(r.result)
            dropped[key] = dropped.get(key, 0) + 1
    if dropped:
        lines += ["Dropped: " + ", ".join(f"{k}: {v}" for k, v in sorted(dropped.items())), ""]
    lines += ["### The founder's Pexels picks", ""]
    for r in records:
        if r.source != "pexels":
            continue
        s = r.site_clip
        m = r.measurements
        lines += [f"**[{r.clip_id}]({r.page_url})** ({r.width}x{r.height}, {r.duration_s:.0f} s,"
                  f" by {r.author or 'unknown'}). Filters: {r.result}; hands "
                  f"{_pct(m.get('both_hands_whole'))}, blur {_pct(m.get('blur_ratio'))}, faces "
                  f"{m.get('confident_faces', 0)}, viewpoint {m.get('viewpoint')}.", ""]
        if s.get("error"):
            lines += [f"Site-clips pipeline: {s['error']}", ""]
        elif s:
            why = "; ".join(x["message"] for x in s.get("reasons", [])) or "none"
            a, b = s["window_s"]
            lines += [f"Site-clips cut {a}-{b} s ({s['window_choice']}): worker "
                      f"**{s['decision']}**; reasons: {why}. Both hands whole in the "
                      f"window {_pct(s.get('both_hands_whole_in_window'))}, worker hands ratio "
                      f"{_pct(s.get('hands_ratio_both_manipulation'))}, blur "
                      f"{_pct(s.get('blur_ratio'))}, faces {s.get('faces')}, viewpoint "
                      f"{s.get('viewpoint')}.", "",
                      img(s.get("poster"), f"{r.clip_id} poster"), ""]
        lines += [img(r.sheet, f"{r.clip_id} contact sheet"), ""]
    lines += ["### Pixabay candidates", ""]
    for i, r in enumerate(top, 1):
        lines += [f"{i}. [{r.clip_id}]({r.page_url}) by {r.author or 'unknown'}, query "
                  f"\"{r.query}\"", "", img(r.sheet, r.clip_id), ""]
    if near:
        lines += ["### Near misses (NOT passing: both hands whole 30-60%, every other filter "
                  "passed)", "", f"Shown because fewer than {MIN_SHOWN} clips passed. A hero "
                  "from this list would need a window where both hands stay in frame.", ""]
        for r in near:
            lines += [f"- [{r.clip_id}]({r.page_url}) by {r.author or 'unknown'}, both hands "
                      f"whole {_pct(r.measurements.get('both_hands_whole'))}", "",
                      img(r.sheet, r.clip_id), ""]
    return "\n".join(lines) + "\n"


def main(argv: Sequence[str] | None = None) -> int:  # pragma: no cover - network, models
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawTextHelpFormatter)
    ap.add_argument("cmd", nargs="?", default="run", choices=["run", "viewpoint"])
    ap.add_argument("path", nargs="?", type=Path)
    ap.add_argument("--out", type=Path, default=Path("out/hero"))
    ap.add_argument("--sheets", type=Path, default=Path("reports/hero-candidates"))
    ap.add_argument("--jsonl", type=Path, default=Path("test_sets/hero_candidates.jsonl"))
    ap.add_argument("--final-dir", type=Path, default=Path("out/hero/final"))
    ap.add_argument("--image-base", default="")
    ap.add_argument("--per-query", type=int, default=10)
    ap.add_argument("--limit", type=int, default=240)
    ap.add_argument("--no-pixabay", action="store_true")
    a = ap.parse_args(argv)
    if a.cmd == "viewpoint":
        return _viewpoint_child(a.path)

    from quellix_hands.model import HandsModel

    from . import site_clips as sc
    from .datasets import pexels

    net = pexels.UrllibNet()
    work = a.out / "work"
    work.mkdir(parents=True, exist_ok=True)
    a.sheets.mkdir(parents=True, exist_ok=True)
    for old in a.sheets.glob("*.jpg"):
        old.unlink()
    records: list[Record] = []
    stats: dict[str, Any] = {}

    def analyse_hit(hit: Hit, path: Path, license_: str, always_sheet: bool) -> Record:
        m = measure(path, viewpoint_probe)
        rec = record_for(hit, m, None, license_)
        hands = m.both_hands_whole or 0.0
        if always_sheet or rec.result == "candidate" or hands >= NEAR_MISS_HANDS:
            name = f"{hit.clip_id}.jpg"
            try:
                contact_sheet(sheet_frames(path), sheet_title(hit, m), a.sheets / name)
                rec.sheet = name
            except Exception as e:  # noqa: BLE001
                print(f"{hit.clip_id}: no sheet: {e}", flush=True)
        print(f"{hit.clip_id}: {rec.result}", flush=True)
        return rec

    key = os.environ.get("PIXABAY_API_KEY", "")
    if a.no_pixabay:
        stats["note"] = "Pixabay search skipped (--no-pixabay)."
    elif not key:
        stats["note"] = "Pixabay search SKIPPED: PIXABAY_API_KEY is not set."
    else:
        hits = search(net.get, key, QUERIES, a.per_query, a.limit)
        stats["searched"] = len(hits)
        for hit in hits:
            dst = work / f"{hit.clip_id}.mp4"
            try:
                net.download(hit.url, dst)
            except Exception as e:  # noqa: BLE001
                records.append(record_for(hit, Measured(error=f"download: {e}"[:200]), None,
                                          PIXABAY_LICENSE))
                continue
            records.append(analyse_hit(hit, dst, PIXABAY_LICENSE, False))
            dst.unlink(missing_ok=True)
        stats["pixabay"] = sum(1 for r in records if r.source == "pixabay")
    top = survivors(records)
    near = near_misses(records, MIN_SHOWN - len(top))
    keep = {r.sheet for r in (*top, *near)}
    for r in records:                       # sheets only for the shown candidates
        if r.source == "pixabay" and r.sheet and r.sheet not in keep:
            (a.sheets / r.sheet).unlink(missing_ok=True)
            r.sheet = None

    got, errors = sc.fetch_pexels(net, work, founder_picks(), os.environ.get("PEXELS_API_KEY", ""))
    if errors:
        stats["note"] = str(stats.get("note", "")) + " Pexels problems: " + "; ".join(errors)
    hands, worker = HandsModel(), sc.worker_check_via_cli()
    for item in got:
        dur, w, h, _ = sc.video_info(item.path)
        hit = Hit("pexels", int(item.clip_id.split("_")[1]), item.source.page_url,
                  item.source.author, item.source.task, dur, w, h, "", "founder pick")
        rec = analyse_hit(hit, item.path, pexels.LICENSE, True)
        try:
            rec.site_clip = site_clip(item, hands, worker, sc.DEFAULT_RUBRIC, a.final_dir,
                                      a.sheets, viewpoint_probe)
        except Exception as e:  # noqa: BLE001
            rec.site_clip = {"error": f"{type(e).__name__}: {e}"[:300]}
        records.append(rec)
    write_jsonl(records, a.jsonl)
    (a.out / "comment.md").write_text(comment(records, top, a.image_base, stats, near))
    print(json.dumps({"records": len(records), "shown": len(top), **stats}, indent=1))
    return 0


if __name__ == "__main__":  # pragma: no cover
    sys.exit(main())
