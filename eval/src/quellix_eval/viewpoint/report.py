"""Score the worker's viewpoint check on the labelled feature file (#79).

    python -m quellix_eval.viewpoint.report --features reports/viewpoint/features.jsonl.gz \\
        --out reports/viewpoint [--overlays --work out/viewpoint]

The verdict is the worker's own `checks.viewpoint.measure` applied to the stored features: the
hands model's landmarks, the faces the privacy check would keep (every 2nd frame, confident,
persistent) and the camera shift of each motion pair. Errors are reported on `dev` (where the
constants were fitted) and `held_out` (never looked at while fitting), with Wilson CIs.
"""

from __future__ import annotations

import argparse
import json
import sys
from collections.abc import Sequence
from pathlib import Path
from typing import Any

from quellix_worker.checks import privacy
from quellix_worker.checks import viewpoint as vp

from ..benchmark.stats import wilson
from .data import KEEP, ClipFeatures, apply_labels, load

KP_INDEX = {k: i for i, k in enumerate(KEEP)}


def hands_of(clip: ClipFeatures) -> list[list[vp.HandView]]:
    return [[vp.HandView(h.state, {k: tuple(h.kp[KP_INDEX[k]]) for k in (vp.WRIST,
                                                                          vp.MIDDLE_MCP)})
             for h in f.hands] for f in clip.frames]


def face_share(clip: ClipFeatures) -> float:
    """What the privacy check would report as confident faces, as a share of analysed frames."""
    analysed = clip.frames[::privacy.PRIVACY_STRIDE]
    raw = [{"t_s": f.t, "box": b[:4], "score": b[4]} for f in analysed for b in f.faces]
    kept = privacy.persistent([d for d in raw if privacy._is_confident("faces", d)])
    return vp.face_share(kept, [f.t for f in analysed])


def shifts_of(clip: ClipFeatures) -> list[float | None]:
    return [float((dx * dx + dy * dy) ** 0.5) if r >= 0.02 else None for dx, dy, r in clip.motion]


def measure(clip: ClipFeatures) -> dict[str, Any]:
    aspect = (clip.width or 16) / (clip.height or 9)
    return vp.measure(hands_of(clip), aspect, face_share(clip), shifts_of(clip))


def _rate(k: int, n: int) -> str:
    if not n:
        return "n/a"
    lo, hi = wilson(k, n) or (0.0, 0.0)
    return f"{k / n:.2f} [{lo:.2f}-{hi:.2f}] ({k}/{n})"


def table(rows: Sequence[tuple[ClipFeatures, dict[str, Any]]], split: str) -> list[str]:
    fp = [m for c, m in rows if c.label == "first_person" and c.split in split]
    tp = [m for c, m in rows if c.label == "third_person" and c.split in split]
    return [
        f"| {split.replace(',', ' + ')} | {len(fp)} | "
        f"{_rate(sum(m['viewpoint'] == 'third_person' for m in fp), len(fp))} | "
        f"{_rate(sum(m['viewpoint'] == 'uncertain' for m in fp), len(fp))} | {len(tp)} | "
        f"{_rate(sum(m['viewpoint'] == 'first_person' for m in tp), len(tp))} | "
        f"{_rate(sum(m['viewpoint'] == 'uncertain' for m in tp), len(tp))} | "
        f"{_rate(sum(m['viewpoint'] == 'third_person' for m in tp), len(tp))} |"]


def per_source(rows: Sequence[tuple[ClipFeatures, dict[str, Any]]]) -> list[str]:
    out = ["| source | label | clips | first-person | uncertain | third-person |",
           "|---|---|---|---|---|---|"]
    keys = sorted({(c.source.split(":")[0], c.label or "unlabelled") for c, _ in rows})
    for src, lab in keys:
        ms = [m for c, m in rows if c.source.split(":")[0] == src and (c.label or
                                                                       "unlabelled") == lab]
        n = len(ms)
        cnt = {v: sum(m["viewpoint"] == v for m in ms) for v in
               ("first_person", "uncertain", "third_person")}
        out.append(f"| {src} | {lab} | {n} | {cnt['first_person']} | {cnt['uncertain']} | "
                   f"{cnt['third_person']} |")
    return out


def render(clips: Sequence[ClipFeatures], run: str, overlays: dict[str, str]) -> str:
    rows = [(c, measure(c)) for c in clips if not c.error and c.frames]
    labelled = [(c, m) for c, m in rows if c.label]
    L = ["# Viewpoint check (#79)", "",
         f"{run} · worker `{vp.MODEL}` applied to the stored features. Labels come from the "
         "sources (Egocentric-10K and HoloAssist are head-mounted; the Pexels clips are the "
         "founder's picks; Pixabay clips are labelled by eye from their contact sheets, "
         "founder veto on #79), never from Ormes. Constants fitted on `dev` only; `held_out` was "
         "not looked at while fitting. For now both a wrong viewpoint and `uncertain` send the "
         "video to review (the check cannot reject yet).",
         "", "**Before:** Ormes had no viewpoint check: every third-person video went through "
         "as if first-person (third-person caught: 0%).", "",
         "| split | first-person clips | called third-person (costly error) | uncertain "
         "(review) | third-person clips | called first-person (missed) | uncertain (review) | "
         "caught |", "|---|---|---|---|---|---|---|---|"]
    for split in ("dev", "held_out", "dev,held_out"):
        L += table(labelled, split)
    L += ["", "By source (all splits):", ""] + per_source(rows)
    L += ["", "Every labelled clip:", "",
          "| clip | split | label | verdict | first_person_ratio | hand frames | pointing up "
          "(median) | hand scale | face share | still share |",
          "|---|---|---|---|---|---|---|---|---|---|"]
    order = {"first_person": 0, "third_person": 1}
    for c, m in sorted(labelled, key=lambda x: (order.get(x[0].label or "", 2), x[0].clip_id)):
        mark = "" if m["viewpoint"] in (c.label, "uncertain") else " **x**"
        L.append(f"| {c.clip_id} | {c.split} | {c.label} | {m['viewpoint']}{mark} | "
                 f"{m['first_person_ratio']} | {m['hand_frames']} | {m['pointing_up_median']} | "
                 f"{m['hand_scale_median']} | {m['face_share']} | {m['still_share']} |")
    errors = [c for c in clips if c.error]
    if errors:
        L += ["", f"Not scored ({len(errors)}): " + ", ".join(
            f"`{c.clip_id}` ({(c.error or '')[:80]})" for c in errors[:20])]
    if overlays:
        L += ["", "## Overlays", "",
              "Green arrow: a hand pointing up the frame (wrist -> middle knuckle); red: not. "
              "Confident faces (as the privacy check counts them) are boxed.", ""]
        L += [f"![{cid}]({{IMAGE_BASE}}{name})" for cid, name in overlays.items()]
    return "\n".join(L) + "\n"


def overlay_picks(clips: Sequence[ClipFeatures], pixabay_max: int = 14) -> list[ClipFeatures]:
    """Every labelled Pexels clip, and up to `pixabay_max` Pixabay ones: wrong verdicts first,
    then held-out ones."""
    ok = [c for c in clips if c.label and not c.error and c.frames]
    pexels = [c for c in ok if c.source.startswith("pexels")]
    pix = [c for c in ok if c.source.startswith("pixabay")]

    def rank(c: ClipFeatures) -> tuple[int, int, str]:
        v = measure(c)["viewpoint"]
        return (0 if v not in (c.label, "uncertain") else 1, 0 if c.split == "held_out" else 1,
                c.clip_id)

    return pexels + sorted(pix, key=rank)[:pixabay_max]


def draw_overlays(clips: Sequence[ClipFeatures], work: Path, out: Path) -> dict[str, str]:
    """Annotated frames for some Pexels / Pixabay clips (downloaded again)."""
    import os

    import cv2
    import numpy as np
    from quellix_worker import media

    from ..datasets import pexels as px

    net = px.UrllibNet()
    names: dict[str, str] = {}
    for c in clips:
        if not c.source.startswith(("pexels", "pixabay")) or c.error or not c.label:
            continue
        pid = int(c.clip_id.split("_")[1])
        try:
            if c.source.startswith("pixabay"):
                from ..datasets import pixabay as pb

                key = os.environ.get("PIXABAY_API_KEY", "")
                hit = pb.by_id(net, key, pid) if key else None
                if hit is None:
                    continue
                path = pb.download(net, hit, work)
            else:
                path, _ = px.fetch_pick(net, px.Pick(pid, c.note or "video", "", "landscape"),
                                        work, os.environ.get("PEXELS_API_KEY", ""))
            v = media.decode(path)
            m = measure(c)
            hands = hands_of(c)
            i = max(range(len(v.frames)), key=lambda j: len(hands[j]) if j < len(hands) else -1)
            img = cv2.cvtColor(v.frames[i].rgb, cv2.COLOR_RGB2BGR)
            h, w = img.shape[:2]
            for hv in hands[i]:
                (wx, wy), (mx, my) = hv.kp[vp.WRIST], hv.kp[vp.MIDDLE_MCP]
                up = vp.pointing_up(hv, w / h) or 0
                cv2.arrowedLine(img, (int(wx * w), int(wy * h)), (int(mx * w), int(my * h)),
                                (0, 200, 0) if up >= vp.UP_MIN else (0, 0, 220), 3,
                                tipLength=0.3)
            for b in c.frames[i].faces:
                if not privacy._is_confident("faces", {"box": b[:4], "score": b[4]}):
                    continue
                cv2.rectangle(img, (int(b[0] * w), int(b[1] * h)),
                              (int((b[0] + b[2]) * w), int((b[1] + b[3]) * h)), (255, 0, 255), 2)
            img = cv2.resize(img, (360, round(h * 360 / w)), interpolation=cv2.INTER_AREA)
            bar = np.full((40, 360, 3), 255, np.uint8)
            cv2.putText(bar, f"{c.clip_id} label {c.label}", (4, 15), cv2.FONT_HERSHEY_SIMPLEX,
                        0.42, (0, 0, 0), 1, cv2.LINE_AA)
            ok = m["viewpoint"] in (c.label, "uncertain")
            cv2.putText(bar, f"Ormes: {m['viewpoint']} (fp ratio {m['first_person_ratio']})",
                        (4, 33), cv2.FONT_HERSHEY_SIMPLEX, 0.42,
                        (0, 120, 0) if ok else (0, 0, 200), 1, cv2.LINE_AA)
            name = f"{c.clip_id}.jpg"
            out.mkdir(parents=True, exist_ok=True)
            cv2.imwrite(str(out / name), np.vstack([bar, img]), [cv2.IMWRITE_JPEG_QUALITY, 78])
            names[c.clip_id] = name
            path.unlink(missing_ok=True)
        except Exception as e:  # noqa: BLE001 - an overlay is a nice-to-have
            print(f"overlay {c.clip_id}: {e}", file=sys.stderr)
    return names


def main(argv: Sequence[str] | None = None) -> int:  # pragma: no cover
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawTextHelpFormatter)
    ap.add_argument("--features", type=Path, required=True)
    ap.add_argument("--out", type=Path, required=True)
    ap.add_argument("--overlays", action="store_true")
    ap.add_argument("--work", type=Path, default=Path("out/viewpoint"))
    ap.add_argument("--run", default="local run")
    a = ap.parse_args(argv)
    clips = apply_labels(load(a.features))
    overlays = (draw_overlays(overlay_picks(clips), a.work, a.out / "overlays")
                if a.overlays else {})
    overlays = {k: f"overlays/{v}" for k, v in overlays.items()}
    md = render(clips, a.run, overlays)
    (a.out / "README.md").write_text(md.replace("{IMAGE_BASE}", ""))
    (a.out / "comment.md").write_text(md)
    (a.out / "scores.json").write_text(json.dumps(
        {c.clip_id: measure(c) for c in clips if not c.error and c.frames}, indent=1))
    print(md)
    return 0


if __name__ == "__main__":  # pragma: no cover
    sys.exit(main())
