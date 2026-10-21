import cv2
import numpy as np
import pytest

from quellix_worker import media
from quellix_worker.checks import originality as orig

from .clips import scene, write_clip

ORG, OTHER_ORG = "org-a", "org-b"


def decoded(path):
    return media.decode(path, sample_fps=2)


@pytest.fixture(scope="module")
def reference(tmp_path_factory):
    d = tmp_path_factory.mktemp("o")
    frames = scene(10, 80)
    return d, frames, write_clip(d / "ref.mp4", frames)


@pytest.fixture
def store(reference):
    s = orig.InMemoryFingerprintStore()
    _, _, ref = reference
    out, prints = orig.run(decoded(ref), ORG, s, "ref")
    assert out.measurements["max_similarity"] == 0.0
    s.add(ORG, "ref", prints)
    return s


def check(path, store, org=ORG):
    out, _ = orig.run(decoded(path), org, store, "new")
    return out.measurements


def test_unrelated_video_is_original(tmp_path, store):
    m = check(write_clip(tmp_path / "x.mp4", scene(99, 80)), store)
    assert m["max_similarity"] < 0.2 and m["match_video_id"] is None


def test_exact_copy(reference, store):
    _, _, ref = reference
    m = check(ref, store)
    assert m["max_similarity"] == 1.0 and m["match_video_id"] == "ref"


def test_reencode(reference, store, tmp_path):
    _, frames, _ = reference
    small = [cv2.resize(f, (120, 90)) for f in frames]
    m = check(write_clip(tmp_path / "re.mp4", small), store)
    assert m["max_similarity"] >= 0.9


def test_mirror(reference, store, tmp_path):
    _, frames, _ = reference
    m = check(write_clip(tmp_path / "mi.mp4", [f[:, ::-1].copy() for f in frames]), store)
    assert m["max_similarity"] >= 0.9


def test_crop(reference, store, tmp_path):
    _, frames, _ = reference
    cropped = [cv2.resize(f[6:-6, 8:-8], (160, 120)) for f in frames]  # ~5% border
    m = check(write_clip(tmp_path / "cr.mp4", cropped), store)
    assert m["max_similarity"] >= 0.9


def test_speed_change(reference, store, tmp_path):
    _, frames, _ = reference
    m = check(write_clip(tmp_path / "sp.mp4", frames[::2], fps=10), store)  # 2x faster
    assert m["max_similarity"] >= 0.9


def test_scoped_to_org(reference, store):
    _, _, ref = reference
    m = check(ref, store, org=OTHER_ORG)
    assert m["max_similarity"] == 0.0 and m["match_video_id"] is None


def test_embedder_interface_is_used(reference, tmp_path):
    class Fake:
        name = "fake"

        def embed(self, frames):
            v = np.zeros((len(frames), 4), dtype=np.float32)
            v[:, 0] = 1
            return v

    _, _, ref = reference
    s = orig.InMemoryFingerprintStore()
    _, prints = orig.run(decoded(ref), ORG, s, "ref", embedder=Fake())
    s.add(ORG, "ref", prints)
    # different pictures, identical embeddings -> still a copy for the embedding path
    out, _ = orig.run(decoded(write_clip(tmp_path / "u.mp4", scene(77, 80))), ORG, s, "n",
                      embedder=Fake())
    assert out.measurements["max_similarity"] == 1.0


def test_noop_embedder():
    assert orig.NoopEmbedder().embed([]) is None
