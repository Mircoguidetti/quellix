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


class FakeEmbedder:
    """Same vector for every frame: any two videos then look like copies on this path."""

    name = "fake-emb"

    def embed(self, frames):
        v = np.zeros((len(frames), 4), dtype=np.float32)
        v[:, 0] = 1
        return v


def test_embedding_rows_and_matching(reference, tmp_path):
    _, _, ref = reference
    s = orig.InMemoryFingerprintStore()
    _, prints = orig.run(decoded(ref), ORG, s, "ref", embedder=FakeEmbedder())
    pdq_rows = [p for p in prints if p.pdq is not None]
    emb_rows = [p for p in prints if p.embedding is not None]
    assert all(p.embedding is None and p.model == "pdq" for p in pdq_rows)
    assert emb_rows and all(p.pdq is None and p.model == "fake-emb" for p in emb_rows)
    s.add(ORG, "ref", prints)
    other = write_clip(tmp_path / "u.mp4", scene(77, 80))
    out, _ = orig.run(decoded(other), ORG, s, "n", embedder=FakeEmbedder())
    assert out.measurements["max_similarity"] == 1.0
    out, _ = orig.run(decoded(other), OTHER_ORG, s, "n", embedder=FakeEmbedder())
    assert out.measurements["max_similarity"] == 0.0  # still scoped to the org


def test_dinov2_embedder_if_weights_available(tmp_path):
    torch = pytest.importorskip("torch")
    pytest.importorskip("transformers")
    emb = orig.DinoV2Embedder()
    try:
        frames = media.decode(write_clip(
            tmp_path / "dino.mp4", scene(1, 10)), 2).frames
        v = emb.embed(frames)
    except Exception as exc:  # no network / weights in the sandbox
        pytest.skip(f"DINOv2 weights unavailable: {exc}")
    assert v.shape == (len(frames), 384) and torch.isfinite(torch.from_numpy(v)).all()
    assert np.allclose(np.linalg.norm(v, axis=1), 1.0, atol=1e-4)


def test_noop_embedder():
    assert orig.NoopEmbedder().embed([]) is None
