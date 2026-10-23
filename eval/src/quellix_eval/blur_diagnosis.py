"""The blur check before and after the plain-background fix (issue #22).

    python -m quellix_eval.blur_diagnosis --out out/blur --report-dir reports/blur-diagnosis \\
        --sources 40

Before = the old rule (variance of the Laplacian of the whole 480 px frame < 60).
After = the worker's current `technical.sharpness` (textured tiles, weakest direction).
Both read the same frames, decoded by the worker's own `media.decode`. Nothing here sets a
threshold: the "after" constants live in the worker and were calibrated on other images.

Scored:
- the founder's Pexels clips: coffee (7658012, plain white worktop), pestle (6693828, dark plain
  marble) and the 7 third-person clips of `test_sets/third_person_pexels.jsonl` (all sharp to the
  eye, so every "blurry" verdict there is a false reject), with the site-clips rubric limit;
- benchmark v2's synthetic slice (Egocentric-10K originals + the same round-robin defects), with
  the eval rubric: the full technical verdict (blur or exposure) on every clip whose technical
  label is known, plus the `blur` defect applied to every original (more false-accept samples).

Writes `README.md` (report, images linked relatively), `comment.md` (the same with the
`{IMAGE_BASE}` placeholder for absolute links), small annotated JPEGs and `results.json`.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from collections.abc import Callable, Sequence
from dataclasses import asdict, dataclass, field
from pathlib import Path

import cv2
import numpy as np
from quellix_worker import media
from quellix_worker.checks import technical

from .benchmark.stats import wilson
from .datasets.manifest import ClipRecord

OLD_LAPLACIAN_VAR = 60.0
RUBRICS = Path(__file__).resolve().parents[2] / "rubrics"
FRAMES_PER_CLIP = 4
FRAME_WIDTH = 400


def old_score(gray: np.ndarray) -> float:
    return float(cv2.Laplacian(gray, cv2.CV_64F).var())


def old_blurry(score: float) -> bool:
    return score < OLD_LAPLACIAN_VAR


def new_blurry(score: float | None) -> bool:
    return score is not None and score < technical.BLUR_SHARPNESS


@dataclass
class Scored:
    clip_id: str
    group: str
    expected: str | None = None          # technical label: "pass" / "fail" / None (not asserted)
    note: str = ""
    error: str | None = None
    times: list[float] = field(default_factory=list)
    old: list[float] = field(default_factory=list)
    new: list[float | None] = field(default_factory=list)
    old_exposure_bad: list[bool] = field(default_factory=list)

    @property
    def n(self) -> int:
        return len(self.times)

    def old_ratio(self) -> float:
        return sum(old_blurry(s) for s in self.old) / self.n if self.n else 0.0

    def new_ratio(self) -> float:
        return sum(new_blurry(s) for s in self.new) / self.n if self.n else 0.0

    def unmeasurable(self) -> float:
        return sum(s is None for s in self.new) / self.n if self.n else 0.0

    def exposure_ratio(self) -> float:
        return sum(self.old_exposure_bad) / self.n if self.n else 0.0


def score_frames(grays: Sequence[np.ndarray], times: Sequence[float], s: Scored) -> Scored:
    s.times = [round(t, 2) for t in times]
    s.old = [round(old_score(g), 1) for g in grays]
    s.new = [None if (v := technical.sharpness(g)) is None else round(v, 1) for g in grays]
    s.old_exposure_bad = [technical.is_badly_exposed(g) for g in grays]
    return s


def decode_grays(path: Path) -> tuple[list[np.ndarray], list[float]]:
    v = media.decode(path)
    if not v.info.decodable:
        raise RuntimeError("not decodable")
    return [cv2.cvtColor(f.rgb, cv2.COLOR_RGB2GRAY) for f in v.frames], [f.t_s for f in v.frames]


def technical_fails(s: Scored, cfg: dict, after: bool) -> bool:
    blur = s.new_ratio() if after else s.old_ratio()
    return blur > cfg["max_blur_ratio"] or s.exposure_ratio() > cfg["max_bad_exposure_ratio"]


# --- frames for the issue -----------------------------------------------------------------


def textured_tiles(gray: np.ndarray) -> tuple[tuple[int, int], np.ndarray]:
    """The worker's tile grid (cols, rows) and which tiles have texture (same rule)."""
    g = gray.astype(np.float32)
    h, w = g.shape
    grid = (max(1, round(w / technical.TILE_PX)), max(1, round(h / technical.TILE_PX)))
    mean = cv2.resize(g, grid, interpolation=cv2.INTER_AREA)
    sq = cv2.resize(g * g, grid, interpolation=cv2.INTER_AREA)
    gain = min(technical.MAX_GAIN,
               max(1.0, technical.GAIN_TARGET / max(float(np.percentile(g, 99)), 1.0)))
    std = np.sqrt(np.maximum(sq - mean * mean, 0.0)) * gain
    return grid, std >= technical.TEXTURE_STD


def annotate(rgb: np.ndarray, t: float, old: float, new: float | None) -> np.ndarray:
    """The frame with plain tiles shaded and both measures written on top."""
    gray = cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY)
    (cols, rows), tex = textured_tiles(gray)
    img = cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR).copy()
    h, w = gray.shape
    shade = img.copy()
    for r in range(rows):
        for c in range(cols):
            if not tex[r, c]:
                x0, x1 = w * c // cols, w * (c + 1) // cols
                y0, y1 = h * r // rows, h * (r + 1) // rows
                cv2.rectangle(shade, (x0, y0), (x1, y1), (160, 60, 160), -1)
    img = cv2.addWeighted(shade, 0.35, img, 0.65, 0)
    scale = FRAME_WIDTH / w
    img = cv2.resize(img, (FRAME_WIDTH, round(h * scale)), interpolation=cv2.INTER_AREA)
    bar = np.full((44, FRAME_WIDTH, 3), 255, np.uint8)
    before = f"before: LapVar {old:.0f} -> {'BLURRY' if old_blurry(old) else 'sharp'}"
    after = ("after: no texture -> not judged" if new is None else
             f"after: sharpness {new:.0f} -> {'BLURRY' if new_blurry(new) else 'sharp'}")
    cv2.putText(bar, f"t={t:.1f}s  {before}", (6, 17), cv2.FONT_HERSHEY_SIMPLEX, 0.45,
                (0, 0, 200) if old_blurry(old) else (0, 120, 0), 1, cv2.LINE_AA)
    cv2.putText(bar, after, (6, 37), cv2.FONT_HERSHEY_SIMPLEX, 0.45,
                (0, 0, 200) if new_blurry(new) else (0, 120, 0), 1, cv2.LINE_AA)
    return np.vstack([bar, img])


def pick_frames(s: Scored, k: int = FRAMES_PER_CLIP) -> list[int]:
    """The frame the old rule found least sharp, plus evenly spaced ones."""
    if not s.n:
        return []
    worst = int(np.argmin(s.old))
    spread = [int(round(x)) for x in np.linspace(0, s.n - 1, k)]
    out = sorted({worst, *spread})
    while len(out) > k:
        out.remove(next(i for i in out if i != worst))
    return out


def save_frames(path: Path, s: Scored, out_dir: Path) -> list[str]:
    v = media.decode(path)
    names = []
    for i in pick_frames(s):
        f = v.frames[i]
        name = f"{s.clip_id}_t{f.t_s:05.1f}.jpg"
        cv2.imwrite(str(out_dir / name), annotate(f.rgb, f.t_s, s.old[i], s.new[i]),
                    [cv2.IMWRITE_JPEG_QUALITY, 80])
        names.append(name)
    return names


# --- report ---------------------------------------------------------------------------------


def _rate(k: int, n: int) -> str:
    if n == 0:
        return "n/a"
    lo, hi = wilson(k, n) or (0.0, 0.0)
    return f"{k / n:.2f} [{lo:.2f}-{hi:.2f}] ({k}/{n})"


def _pct(x: float) -> str:
    return f"{x * 100:.0f}%"


def pexels_table(rows: Sequence[Scored], limit: float) -> list[str]:
    out = [f"Limit: blurry frames at most {_pct(limit)} (site-clips rubric). Every clip is sharp "
           "to the eye, so a \"reject\" is a false reject.", "",
           "| clip | frames | before: blurry frames | before | after: blurry frames | after | "
           "frames without texture | median sharpness (after) |",
           "|---|---|---|---|---|---|---|---|"]
    for s in rows:
        if s.error:
            out.append(f"| {s.clip_id} ({s.note}) | - | download/decode failed: {s.error[:150]} "
                       "| | | | | |")
            continue
        med = [v for v in s.new if v is not None]
        median = f"{np.median(med):.0f}" if med else "n/a"
        out.append(
            f"| {s.clip_id} ({s.note}) | {s.n} | {_pct(s.old_ratio())} | "
            f"{'**reject**' if s.old_ratio() > limit else 'pass'} | {_pct(s.new_ratio())} | "
            f"{'**reject**' if s.new_ratio() > limit else 'pass'} | {_pct(s.unmeasurable())} | "
            f"{median} |")
    return out


def error_rates(rows: Sequence[Scored], cfg: dict, after: bool) -> tuple[str, str]:
    """(false reject rate, false accept rate) of the technical verdict on labelled clips."""
    good = [s for s in rows if s.expected == "pass" and not s.error]
    bad = [s for s in rows if s.expected == "fail" and not s.error]
    fr = sum(technical_fails(s, cfg, after) for s in good)
    fa = sum(not technical_fails(s, cfg, after) for s in bad)
    return _rate(fr, len(good)), _rate(fa, len(bad))


def blur_rates(rows: Sequence[Scored], cfg: dict, after: bool, should_blur: bool) -> str:
    rows = [s for s in rows if not s.error]
    wrong = sum(((s.new_ratio() if after else s.old_ratio()) > cfg["max_blur_ratio"])
                != should_blur for s in rows)
    return _rate(wrong, len(rows))


def render(pexels: Sequence[Scored], frames: dict[str, list[str]], synthetic: dict | None,
           image_base: str, site_cfg: dict, eval_cfg: dict, run: str) -> str:
    L = ["# Blur check: before / after (#22)", "",
         f"{run} · before = variance of the Laplacian of the whole 480 px frame < "
         f"{OLD_LAPLACIAN_VAR:.0f}; after = worker `{technical.MODEL}`: sharpness of the "
         f"sharpest {technical.TOP_SHARE:.0%} of the textured tiles (luma std >= "
         f"{technical.TEXTURE_STD:.0f}, ~{technical.TILE_PX} px tiles), weakest of 4 directions, "
         f"blurry below {technical.BLUR_SHARPNESS:.0f}; a frame with no textured tile is not "
         "judged. The \"after\" constants were calibrated on scikit-image sample photos with "
         "synthetic blur, never on the clips below.", ""]
    if synthetic:
        L += ["## Benchmark v2 synthetic slice (Egocentric-10K + synthetic defects)", "",
              f"{synthetic['sources']} originals, eval rubric (blurry frames at most "
              f"{_pct(eval_cfg['max_blur_ratio'])}, bad exposure at most "
              f"{_pct(eval_cfg['max_bad_exposure_ratio'])}).", "",
              "Technical check (blur or exposure), every clip with a known technical label:", "",
              "| rule | clips | false reject rate | false accept rate |", "|---|---|---|---|"]
        lab = [s for s in synthetic["slice"] if s.expected in ("pass", "fail") and not s.error]
        for name, after in (("before", False), ("after", True)):
            fr, fa = error_rates(lab, eval_cfg, after)
            L.append(f"| {name} | {len(lab)} | {fr} | {fa} |")
        orig = [s for s in synthetic["slice"] if "__" not in s.clip_id]
        blur_v = [s for s in synthetic["slice"] if s.clip_id.endswith("__blur")]
        L += ["", "Blur alone:", "",
              "| clips | should be | before: wrong | after: wrong |", "|---|---|---|---|",
              f"| originals | sharp (false reject) | {blur_rates(orig, eval_cfg, False, False)} "
              f"| {blur_rates(orig, eval_cfg, True, False)} |",
              f"| `blur` variants in the slice | blurry (false accept) | "
              f"{blur_rates(blur_v, eval_cfg, False, True)} | "
              f"{blur_rates(blur_v, eval_cfg, True, True)} |",
              f"| `blur` applied to every original | blurry (false accept) | "
              f"{blur_rates(synthetic['all_blur'], eval_cfg, False, True)} | "
              f"{blur_rates(synthetic['all_blur'], eval_cfg, True, True)} |"]
        other = [s for s in synthetic["slice"]
                 if "__" in s.clip_id and not s.clip_id.endswith("__blur") and not s.error]
        ob = sum(s.old_ratio() > eval_cfg["max_blur_ratio"] for s in other)
        nb = sum(s.new_ratio() > eval_cfg["max_blur_ratio"] for s in other)
        L += ["", f"Other variants (exposure, overlays, duplicates, hand crops) called blurry: "
              f"before {ob}/{len(other)}, after {nb}/{len(other)} (not labelled for blur: the "
              "hand crops are zooms and do soften the frame).", ""]
        if synthetic.get("error"):
            L += [f"Synthetic slice problem: {synthetic['error']}", ""]
    else:
        L += ["Synthetic slice not run (no `HF_TOKEN` or `--sources 0`).", ""]
    L += ["## Pexels clips", ""]
    L += pexels_table(pexels, site_cfg["max_blur_ratio"])
    L += ["", "## Frames", "",
          "Plain tiles (no texture, ignored by the new measure) are shaded purple. Top line: the "
          "old measure; second line: the new one.", ""]
    for s in pexels:
        if frames.get(s.clip_id):
            L += [f"**{s.clip_id}** ({s.note}): before {_pct(s.old_ratio())} blurry, after "
                  f"{_pct(s.new_ratio())}", ""]
            L += [" ".join(f"![{n}]({image_base}{n})" for n in frames[s.clip_id]), ""]
    return "\n".join(L) + "\n"


# --- runs -------------------------------------------------------------------------------------


def run_pexels(out_dir: Path, fetch: Callable[[object], Path]) -> tuple[
        list[Scored], dict[str, list[str]]]:
    rows: list[Scored] = []
    frames: dict[str, list[str]] = {}
    for pick in pexels_picks():
        s = Scored(pick.clip_id, "pexels", "pass", pick.task)
        try:
            path = fetch(pick)
            grays, times = decode_grays(path)
            score_frames(grays, times, s)
            frames[s.clip_id] = save_frames(path, s, out_dir)
        except Exception as e:  # noqa: BLE001 - reported in the table
            s.error = f"{type(e).__name__}: {e}"
        print(f"{s.clip_id}: before {s.old_ratio():.2f} after {s.new_ratio():.2f} {s.error or ''}")
        rows.append(s)
    return rows, frames


def pexels_picks() -> list:
    from .datasets import pexels as px

    coffee = next(p for p in px.LANDING_CLIPS if p.pexels_id == 7658012)
    pestle = px.Pick(6693828, "person-crushing-the-coffee-powder",
                     "Crushing coffee with a pestle", "landscape", "dark plain marble")
    return [coffee, pestle, *px.THIRD_PERSON]


def run_synthetic(n_sources: int, work: Path) -> dict:  # pragma: no cover - network
    from .ci import _hf_source, build_eval_manifest
    from .datasets.manifest import load_manifest
    from .defects.build import build_variants

    src = work / "sources.jsonl"
    _hf_source(src, work / "sources", n_sources)
    sources = load_manifest(src)
    slice_ = build_eval_manifest(sources, work / "variants")
    all_blur = [r for rec in sources
                for r in build_variants([rec], work / "all-blur", ["blur"])[1:]]
    return {"sources": len(sources), "slice": score_records(slice_, "synthetic"),
            "all_blur": score_records(all_blur, "all_blur")}


def score_records(records: Sequence[ClipRecord], group: str) -> list[Scored]:
    out = []
    for r in records:
        expected = r.checks.get("technical")
        s = Scored(r.clip_id, group, expected if expected in ("pass", "fail") else None)
        try:
            score_frames(*decode_grays(Path(r.path)), s)
        except Exception as e:  # noqa: BLE001
            s.error = f"{type(e).__name__}: {e}"
        out.append(s)
    return out


def main(argv: Sequence[str] | None = None) -> int:  # pragma: no cover - network
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawTextHelpFormatter)
    ap.add_argument("--out", type=Path, required=True, help="work directory (videos)")
    ap.add_argument("--report-dir", type=Path, required=True)
    ap.add_argument("--sources", type=int, default=40, help="Egocentric-10K originals")
    ap.add_argument("--run", default="local run")
    a = ap.parse_args(argv)
    from .datasets import pexels as px

    a.out.mkdir(parents=True, exist_ok=True)
    a.report_dir.mkdir(parents=True, exist_ok=True)
    for old in a.report_dir.glob("*.jpg"):
        old.unlink()
    net = px.UrllibNet()
    key = os.environ.get("PEXELS_API_KEY", "")
    pexels, frames = run_pexels(a.report_dir,
                                lambda pick: px.fetch_pick(net, pick, a.out, key)[0])
    synthetic = None
    if a.sources > 0 and os.environ.get("HF_TOKEN"):
        try:
            synthetic = run_synthetic(a.sources, a.out / "synthetic")
        except Exception as e:  # noqa: BLE001
            synthetic = {"sources": 0, "slice": [], "all_blur": [],
                         "error": f"{type(e).__name__}: {e}"}
    site_cfg = json.loads((RUBRICS / "site_clips.json").read_text())["checks"]["technical"]
    eval_cfg = json.loads((RUBRICS / "eval_v0.json").read_text())["checks"]["technical"]
    (a.report_dir / "README.md").write_text(
        render(pexels, frames, synthetic, "", site_cfg, eval_cfg, a.run))
    (a.report_dir / "comment.md").write_text(
        render(pexels, frames, synthetic, "{IMAGE_BASE}", site_cfg, eval_cfg, a.run))
    dump = {"pexels": [asdict(s) for s in pexels]}
    if synthetic:
        dump["synthetic"] = {k: ([{"clip_id": s.clip_id, "expected": s.expected,
                                   "before": round(s.old_ratio(), 3),
                                   "after": round(s.new_ratio(), 3),
                                   "exposure": round(s.exposure_ratio(), 3), "error": s.error}
                                  for s in v] if isinstance(v, list) else v)
                             for k, v in synthetic.items()}
    (a.report_dir / "results.json").write_text(json.dumps(dump, indent=1))
    print((a.report_dir / "README.md").read_text())
    return 0


if __name__ == "__main__":  # pragma: no cover
    sys.exit(main())
