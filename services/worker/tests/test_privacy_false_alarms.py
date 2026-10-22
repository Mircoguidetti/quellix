"""Privacy false alarms on clean footage (issue #47): persistence, size and score filters."""

import json

import numpy as np
import pytest

from quellix_worker import media
from quellix_worker.checks import privacy

from .clips import scene, write_clip


def d(t, score=None, box=(0.1, 0.1, 0.2, 0.2)):
    out = {"t_s": t, "box": list(box)}
    if score is not None:
        out["score"] = score
    return out


def test_single_frame_hit_is_a_flicker():
    assert privacy.persistent([d(1.0)]) == []


def test_a_run_of_hits_is_kept():
    hits = [d(1.0), d(1.5)]  # privacy looks at 2 fps: two hits are about a second in view
    assert privacy.persistent(hits) == hits


def test_scattered_hits_outside_the_window_are_dropped():
    hits = [d(0.0), d(3.0), d(6.0), d(9.0)]  # one every 3 s: never 2 within 2 s
    assert privacy.persistent(hits) == []


def test_two_runs_are_both_kept():
    run1, run2 = [d(1.0), d(1.5)], [d(20.0), d(20.5)]
    assert privacy.persistent(run1 + [d(9.0)] + run2) == run1 + run2


class Flicker:
    """Detects one face in a single sampled frame only."""

    def __init__(self):
        self.n = 0

    def detect(self, rgb):
        self.n += 1
        return [(0.1, 0.1, 0.2, 0.2, 0.95)] if self.n == 3 else []


class Steady:
    def detect(self, rgb):
        return [(0.1, 0.1, 0.2, 0.2, 0.93)]


def _clip(tmp_path):
    return media.decode(write_clip(tmp_path / "c.mp4", scene(2, 60, size=(320, 180)), fps=15))


def test_flicker_is_not_reported_but_a_steady_face_is(tmp_path):
    video = _clip(tmp_path)
    no_regions = type("N", (), {"detect": lambda self, rgb: []})()
    out = privacy.run(video, faces=Flicker(), documents=no_regions, screens=no_regions)
    assert out.measurements["faces"] == []
    out = privacy.run(video, faces=Steady(), documents=no_regions, screens=no_regions)
    faces = out.measurements["faces"]
    assert len(faces) == len(video.frames[::privacy.PRIVACY_STRIDE])
    assert faces[0]["score"] == 0.93
    json.dumps(out.measurements)


def test_scores_are_plain_floats(tmp_path):
    class F32:
        def detect(self, rgb):
            return [tuple(np.float32(v) for v in (0.1, 0.1, 0.2, 0.2, 0.9))]

    no_regions = type("N", (), {"detect": lambda self, rgb: []})()
    out = privacy.run(_clip(tmp_path), faces=F32(), documents=no_regions, screens=no_regions)
    json.dumps(out.measurements)
    assert type(out.measurements["faces"][0]["score"]) is float


def test_debug_frames_are_written_only_when_asked(tmp_path, monkeypatch):
    video = _clip(tmp_path)
    no_regions = type("N", (), {"detect": lambda self, rgb: []})()
    privacy.run(video, faces=Steady(), documents=no_regions, screens=no_regions, label="clip 1")
    assert not list(tmp_path.glob("**/*.jpg"))
    out_dir = tmp_path / "frames"
    monkeypatch.setenv("QUELLIX_DEBUG_FRAMES_DIR", str(out_dir))
    privacy.run(video, faces=Steady(), documents=no_regions, screens=no_regions, label="clip 1")
    files = sorted(out_dir.glob("clip_1__faces__*.jpg"))
    assert len(files) == len(video.frames[::privacy.PRIVACY_STRIDE])


def test_confidence_tiers_split_confident_from_possible(tmp_path):
    class Mixed:
        def detect(self, rgb):
            return [(0.1, 0.1, 0.2, 0.2, 0.93),     # confident
                    (0.5, 0.1, 0.2, 0.2, 0.65),     # weak score: possible
                    (0.7, 0.1, 0.02, 0.03, 0.95)]   # tiny (2% of the width): possible

    no_regions = type("N", (), {"detect": lambda self, rgb: []})()
    out = privacy.run(_clip(tmp_path), faces=Mixed(), documents=no_regions, screens=no_regions)
    m = out.measurements
    assert {d["score"] for d in m["faces"]} == {0.93}
    assert {d["score"] for d in m["faces_possible"]} == {0.65, 0.95}
    json.dumps(m)


def test_detectors_without_a_score_are_confident(tmp_path):
    class NoScore:
        def detect(self, rgb):
            return [(0.4, 0.4, 0.2, 0.2)]

    no_regions = type("N", (), {"detect": lambda self, rgb: []})()
    out = privacy.run(_clip(tmp_path), faces=NoScore(), documents=no_regions, screens=no_regions)
    assert out.measurements["faces"] and not out.measurements["faces_possible"]


def test_privacy_analyses_every_second_frame(tmp_path):
    seen = []

    class Count:
        def detect(self, rgb):
            seen.append(1)
            return []

    video = _clip(tmp_path)
    no_regions = type("N", (), {"detect": lambda self, rgb: []})()
    privacy.run(video, faces=Count(), documents=no_regions, screens=no_regions)
    assert len(seen) == len(video.frames[::privacy.PRIVACY_STRIDE]) < len(video.frames)


@pytest.mark.parametrize("seed", [11, 12, 13])
def test_clean_textured_footage_has_no_privacy_detections(tmp_path, seed):
    from .test_regressions_23 import have_models

    if not have_models():
        pytest.skip("model weights unavailable")
    out = privacy.run(media.decode(write_clip(tmp_path / "c.mp4", scene(seed, 60), fps=15)))
    assert all(v == [] for v in out.measurements.values())
