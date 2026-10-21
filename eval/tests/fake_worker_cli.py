"""Stand-in for `python -m quellix_worker`: crude pixel heuristics + the real rubric.evaluate."""

import argparse
import json
import sys
from pathlib import Path

import cv2
import numpy as np
from quellix_worker.rubric import CheckOutput, evaluate

from quellix_eval.defects import read_video

ap = argparse.ArgumentParser()
ap.add_argument("cmd")
ap.add_argument("video")
ap.add_argument("--rubric", required=True)
ap.add_argument("--video-id", required=True)
ap.add_argument("--report")
a = ap.parse_args()

clip = read_video(a.video)
gray = [cv2.cvtColor(f, cv2.COLOR_RGB2GRAY) for f in clip.frames]
blur = np.mean([cv2.Laplacian(g, cv2.CV_64F).var() < 20 for g in gray])
bad_exp = np.mean([g.mean() < 35 or g.mean() > 220 for g in gray])
skin = [np.all(np.abs(f.astype(int) - (224, 172, 105)) < 30, axis=2) for f in clip.frames]
w = clip.frames[0].shape[1]
both = float(np.mean([s[:, : w // 2].any() and s[:, w // 2 :].any() for s in skin]))
h, wd = clip.frames[0].shape[:2]
out = {
    "technical": CheckOutput(measurements={
        "decodable": True, "duration_s": len(gray) / clip.fps, "width": wd, "height": h,
        "fps": clip.fps, "blur_ratio": float(blur), "bad_exposure_ratio": float(bad_exp)}),
    "hands_visible": CheckOutput(measurements={
        "ratio_both_manipulation": both, "ratio_any_manipulation": both,
        "ratio_both_whole": both, "ratio_any_whole": both}),
    "framing": CheckOutput(measurements={"off_target_ratio": 0.0, "unstable_ratio": 0.0}),
    "task_completed": CheckOutput(measurements={"completed": len(gray) >= 40, "confidence": 0.9}),
    "privacy": CheckOutput(measurements={"faces": [], "documents": [], "screens": []}),
    "originality": CheckOutput(measurements={"max_similarity": 0.0, "match_video_id": None}),
}
d = evaluate(a.video_id, json.loads(Path(a.rubric).read_text()), out)
if a.report:
    Path(a.report).write_text(json.dumps({"decision": d, "cost_usd": 0.001, "timings_ms": {},
                                          "models": {}}))
json.dump(d, sys.stdout)
