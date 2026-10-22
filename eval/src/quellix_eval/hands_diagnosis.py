"""Look at what the hands model does on real frames (issue #4: the check is too strict).

    python -m quellix_eval.hands_diagnosis VIDEO [VIDEO ...] --out eval/reports/hands-diagnosis

For each video: sample frames, run the real detector with the current model (and the first
version, hands@0.1.0, for comparison) and again with a lenient second pass (low thresholds), and
write
- overlays (JPEG): every landmark (green = inside the frame margin, red = outside it), the hand
  coloured by the per-frame state, the decision of the first version and of the current one
  ("both whole" or not) and, in cyan, hands only the lenient pass found;
- `<name>.json`: per frame the states, which landmarks break the "fully visible" rule, and the
  causes counted below.

Causes it counts, per frame (they decide where the fix goes):
- `miss`: a hand is in the lenient pass but not in the worker's pass (detector);
- `wrist_only`: the hand is called truncated only because the wrist is at the frame edge (the arm
  enters from the border: the hand itself is whole);
- `tips_out`: a fingertip is outside the frame (a really cut hand);
- `gap`: a hand missing for a stretch of at most `GAP_S` between frames where it is seen (no
  temporal smoothing).
"""

from __future__ import annotations

import argparse
import json
from collections.abc import Sequence
from pathlib import Path
from typing import Any

import cv2
import numpy as np

from .site_clips import iter_frames

WRIST = 0
TIPS = (4, 8, 12, 16, 20)
GAP_S = 0.5
CONNECTIONS = [(0, 1), (1, 2), (2, 3), (3, 4), (0, 5), (5, 6), (6, 7), (7, 8), (5, 9), (9, 10),
               (10, 11), (11, 12), (9, 13), (13, 14), (14, 15), (15, 16), (13, 17), (17, 18),
               (18, 19), (19, 20), (0, 17)]
COLOR = {"full": (61, 220, 151), "truncated": (245, 165, 36), "absent": (150, 150, 150)}


def outside(kp: np.ndarray, margin: float) -> list[int]:
    xy = np.asarray(kp, dtype=float)[:, :2]
    return [int(i) for i in np.where(((xy < margin) | (xy > 1 - margin)).any(axis=1))[0]]


def cause_of(hand: Any, margin: float) -> str:
    """Why a detected hand is not 'full': wrist only, fingertips out, or other landmarks."""
    if hand.state != "truncated" or hand.keypoints is None:
        return hand.state
    out = set(outside(hand.keypoints, margin))
    if out and out <= {WRIST}:
        return "wrist_only"
    if out & set(TIPS):
        return "tips_out"
    return "other_landmarks"


def draw_hand(img: np.ndarray, kp: np.ndarray, color: tuple[int, int, int], margin: float,
              label: str, thin: bool = False) -> None:
    h, w = img.shape[:2]
    pts = np.asarray(kp, dtype=float)[:, :2]
    px = [(int(x * w), int(y * h)) for x, y in pts]
    bad = set(outside(kp, margin))
    for a, b in CONNECTIONS:
        cv2.line(img, px[a], px[b], color, 1 if thin else 2, cv2.LINE_AA)
    for i, p in enumerate(px):
        c = (255, 60, 60) if i in bad else ((255, 255, 0) if thin else (255, 255, 255))
        cv2.circle(img, p, 3 if thin else 4, c, -1, cv2.LINE_AA)
    x0, y0 = max(0, min(p[0] for p in px)), max(12, min(p[1] for p in px) - 6)
    cv2.putText(img, label, (min(x0, w - 120), y0), cv2.FONT_HERSHEY_SIMPLEX, 0.45, color, 1,
                cv2.LINE_AA)


def overlay(img: np.ndarray, per: Any, lenient: Sequence[Any], margin: float,
            header: str, before: Any = None) -> np.ndarray:
    """RGB frame -> RGB frame with the worker's decision drawn on it."""
    out = img.copy()
    h, w = out.shape[:2]
    cv2.rectangle(out, (int(margin * w), int(margin * h)),
                  (int((1 - margin) * w) - 1, int((1 - margin) * h) - 1), (255, 255, 255), 1)
    seen = []
    for side in ("left", "right"):
        hand = per.hand(side)
        if hand.keypoints is not None and hand.state != "absent":
            seen.append(np.asarray(hand.keypoints, dtype=float)[:, :2].mean(axis=0))
            draw_hand(out, hand.keypoints, COLOR[hand.state], margin,
                      f"{side} {hand.state} {hand.confidence:.2f} [{cause_of(hand, margin)}]")
    for raw in lenient:       # hands the worker's pass did not report
        c = np.asarray(raw.keypoints, dtype=float)[:, :2].mean(axis=0)
        if all(np.hypot(*(c - s)) > 0.08 for s in seen):
            draw_hand(out, raw.keypoints, (0, 220, 255), margin,
                      f"lenient only {raw.score:.2f}", thin=True)
    both = per.left.full and per.right.full
    text = f"{header}  both whole: {'YES' if both else 'NO'}"
    if before is not None:
        text += f"  (v0: {'YES' if before.left.full and before.right.full else 'NO'})"
    cv2.rectangle(out, (0, 0), (w, 22), (0, 0, 0), -1)
    cv2.putText(out, text, (6, 15), cv2.FONT_HERSHEY_SIMPLEX, 0.5,
                (61, 220, 151) if both else (255, 90, 90), 1, cv2.LINE_AA)
    return out


def gap_flags(seen: Sequence[bool], ts: Sequence[float], gap_s: float = GAP_S) -> list[bool]:
    """True for frames inside a miss of at most `gap_s` between two frames where the hand is seen."""
    flags = [False] * len(seen)
    i = 0
    while i < len(seen):
        if seen[i]:
            i += 1
            continue
        j = i
        while j < len(seen) and not seen[j]:
            j += 1
        if i > 0 and j < len(seen) and ts[j] - ts[i - 1] <= gap_s + 1e-6:
            flags[i:j] = [True] * (j - i)
        i = j
    return flags


def diagnose(
    video: Path, hands: Any, lenient_detector: Any, out_dir: Path, fps: float = 4.0,
    max_overlays: int = 6, start_s: float = 0.0, end_s: float | None = None,
    baseline: Any = None,
) -> dict[str, Any]:
    samples = list(iter_frames(video, fps, start_s, end_s))
    ts, frames = [t for t, _ in samples], [f for _, f in samples]
    pf = hands.frames(frames, ts)
    pf0 = baseline.frames(frames, ts) if baseline is not None else None
    margin = hands.config.margin
    lenient = [lenient_detector.detect(f) for f in frames]
    rows: list[dict[str, Any]] = []
    for per, len_hands, t in zip(pf, lenient, ts, strict=True):
        row: dict[str, Any] = {"t": round(t, 3)}
        for side in ("left", "right"):
            h = per.hand(side)
            row[side] = {"state": h.state, "cause": cause_of(h, margin),
                         "outside": outside(h.keypoints, margin) if h.keypoints is not None else []}
        row["n_lenient"] = len(len_hands)
        row["n_worker"] = sum(per.hand(s).state != "absent" for s in ("left", "right"))
        row["miss"] = row["n_lenient"] > row["n_worker"]
        row["both_whole"] = per.left.full and per.right.full
        rows.append(row)
    if pf0 is not None:
        for row, before in zip(rows, pf0, strict=True):
            row["both_whole_v0"] = before.left.full and before.right.full
    for side in ("left", "right"):
        flags = gap_flags([r[side]["state"] != "absent" for r in rows], ts)
        for r, g in zip(rows, flags, strict=True):
            r[side]["gap"] = g
    n = max(1, len(rows))
    summary = {
        "video": video.name, "frames": len(rows), "fps": fps,
        "both_whole": round(sum(r["both_whole"] for r in rows) / n, 3),
        "both_whole_v0": (round(sum(r["both_whole_v0"] for r in rows) / n, 3)
                          if pf0 is not None else None),
        "both_detected": round(sum(r["n_worker"] == 2 for r in rows) / n, 3),
        "both_detected_lenient": round(sum(r["n_lenient"] >= 2 for r in rows) / n, 3),
        "frames_with_miss": sum(r["miss"] for r in rows),
        "hand_frames_wrist_only": sum(r[s]["cause"] == "wrist_only" for r in rows
                                      for s in ("left", "right")),
        "hand_frames_tips_out": sum(r[s]["cause"] == "tips_out" for r in rows
                                    for s in ("left", "right")),
        "hand_frames_gap": sum(r[s]["gap"] for r in rows for s in ("left", "right")),
    }
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / f"{video.stem}.json").write_text(
        json.dumps({"summary": summary, "frames": rows}, separators=(",", ":")))
    # Overlays: the most telling frames first (a miss, a wrist-only truncation, a gap), then a pass.
    # frames where the first version said no come first: they show what changed (or did not)
    order = [i for i, r in enumerate(rows) if not r["both_whole"] or not r.get("both_whole_v0", 0)]
    order.sort(key=lambda i: (rows[i]["both_whole"], not rows[i]["miss"], i))
    chosen: list[int] = []
    if max_overlays <= 0:
        return summary
    for i in order:
        if all(abs(i - j) >= 3 for j in chosen) and len(chosen) < max_overlays - 1:
            chosen.append(i)
    good = [i for i, r in enumerate(rows) if r["both_whole"]]
    if good:
        chosen.append(good[len(good) // 2])
    for i in sorted(chosen):
        img = overlay(frames[i], pf[i], lenient[i], margin, f"{video.stem} t={ts[i]:.2f}s",
                      pf0[i] if pf0 is not None else None)
        path = out_dir / f"{video.stem}-t{ts[i]:05.2f}s.jpg"
        small = cv2.resize(img, (640, int(img.shape[0] * 640 / img.shape[1])))
        cv2.imwrite(str(path), cv2.cvtColor(small, cv2.COLOR_RGB2BGR), [cv2.IMWRITE_JPEG_QUALITY, 72])
    return summary


def main(argv: Sequence[str] | None = None) -> int:  # pragma: no cover - models
    from quellix_hands.detectors import MediaPipeDetector
    from quellix_hands.model import HandsModel

    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawTextHelpFormatter)
    ap.add_argument("videos", nargs="+", type=Path)
    ap.add_argument("--out", type=Path, default=Path("reports/hands-diagnosis"))
    ap.add_argument("--fps", type=float, default=4.0)
    ap.add_argument("--overlays", type=int, default=6)
    a = ap.parse_args(argv)
    detector = MediaPipeDetector()
    hands, baseline = HandsModel(detector), HandsModel.v0(detector)
    lenient = MediaPipeDetector(min_detection_confidence=0.1, min_presence_confidence=0.1)
    for v in a.videos:
        s = diagnose(v, hands, lenient, a.out, a.fps, a.overlays, baseline=baseline)
        before = diagnose(v, baseline, lenient, a.out / "v0", a.fps, 0)     # the v0 causes
        print(json.dumps({"now": s, "v0": before}))
    return 0


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
