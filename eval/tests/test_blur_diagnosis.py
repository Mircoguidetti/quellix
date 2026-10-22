import json

import cv2
import numpy as np

from quellix_eval import blur_diagnosis as bd
from quellix_eval.datasets.manifest import ClipRecord, TaskSpec
from quellix_eval.defects import write_video

SITE = {"max_blur_ratio": 0.1, "max_bad_exposure_ratio": 0.05}
EVAL = {"max_blur_ratio": 0.05, "max_bad_exposure_ratio": 0.1}


def plain_shot(blur: bool = False, n: int = 30) -> list[np.ndarray]:
    """A small sharp checkered object on a large plain light surface."""
    rng = np.random.default_rng(0)
    frames = []
    for i in range(n):
        f = np.full((270, 480, 3), 200, np.uint8)
        obj = (rng.integers(0, 2, (6, 8)) * 50 + 95).astype(np.uint8)
        obj = cv2.resize(obj, (48, 36), interpolation=cv2.INTER_NEAREST)
        f[190 + i % 3:226 + i % 3, 216:264] = obj[..., None]
        if blur:
            f = cv2.GaussianBlur(f, (0, 0), 4)
        frames.append(f)
    return frames


def test_pexels_run_with_a_fake_download(tmp_path):
    sharp = tmp_path / "sharp.mp4"
    write_video(sharp, plain_shot(), 15)
    picks = bd.pexels_picks()
    assert [p.pexels_id for p in picks[:2]] == [7658012, 6693828] and len(picks) == 9

    def fetch(pick):
        if pick.pexels_id == 7308220:
            raise RuntimeError("HTTP 403")
        return sharp

    rows, frames = bd.run_pexels(tmp_path, fetch)
    coffee = rows[0]
    assert coffee.n > 0 and coffee.new_ratio() == 0
    assert all(bd.old_blurry(v) for v in coffee.old)          # the bug: old rule says blurry
    assert len(frames[coffee.clip_id]) == bd.FRAMES_PER_CLIP
    img = cv2.imread(str(tmp_path / frames[coffee.clip_id][0]))
    assert img.shape[1] == bd.FRAME_WIDTH
    md = bd.render(rows, frames, None, "{IMAGE_BASE}", SITE, EVAL, "test")
    assert "download/decode failed: RuntimeError: HTTP 403" in md
    assert "| pexels_7658012 (Putting ground coffee in a filter) |" in md
    assert "**reject** | 0% | pass |" in md
    assert "![pexels_7658012_t" in md and "]({IMAGE_BASE}pexels_7658012_t" in md
    json.dumps([vars(r) for r in rows])


def test_synthetic_rates(tmp_path):
    good, bad = tmp_path / "g.mp4", tmp_path / "b.mp4"
    write_video(good, plain_shot(), 15)
    write_video(bad, plain_shot(blur=True), 15)
    task = TaskSpec(description="d")

    def rec(cid, path, tech):
        return ClipRecord(clip_id=cid, source="synthetic", license="synthetic", path=str(path),
                          task=task,
                          truth="accept" if tech == "pass" else "reject",
                          checks={"technical": tech})

    rows = bd.score_records([rec("o0", good, "pass"), rec("o0__blur", bad, "fail")], "s")
    synthetic = {"sources": 1, "slice": rows, "all_blur": rows[1:]}
    md = bd.render([], {}, synthetic, "", SITE, EVAL, "test")
    assert "| before | 2 | 1.00 [0.21-1.00] (1/1) | 0.00 [0.00-0.79] (0/1) |" in md
    assert "| after | 2 | 0.00 [0.00-0.79] (0/1) | 0.00 [0.00-0.79] (0/1) |" in md


def test_pick_frames_keeps_the_worst_one():
    s = bd.Scored("c", "g", times=[0.0, 0.25, 0.5, 0.75, 1.0, 1.25],
                  old=[100, 100, 5, 100, 100, 100], new=[50] * 6)
    picked = bd.pick_frames(s, 3)
    assert 2 in picked and len(picked) == 3
