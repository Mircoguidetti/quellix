from quellix_eval.viewpoint import data, report


def clip(cid, label, split, up: bool, faces=None, still=False):
    wrist, knuckle = ((0.5, 0.9), (0.5, 0.75)) if up else ((0.2, 0.5), (0.3, 0.5))  # up / across
    kp = [[0.0, 0.0]] * len(data.KEEP)
    kp[data.KEEP.index(0)], kp[data.KEEP.index(9)] = list(wrist), list(knuckle)
    frames = [data.FrameFeat(i * 0.25, [data.HandFeat("left", "full", 0.9, kp)],
                             faces or []) for i in range(20)]
    motion = [[0.0 if still else 0.01, 0.0, 0.5]] * 20
    return data.ClipFeatures(cid, "pexels:founder" if label else "pexels:candidate", cid, label,
                             split, 640, 360, 5.0, frames, motion)


def test_measure_uses_the_worker_rule():
    assert report.measure(clip("a", "first_person", "dev", up=True))["viewpoint"] == (
        "first_person")
    assert report.measure(clip("b", "third_person", "dev", up=False))["viewpoint"] == (
        "third_person")
    big_face = [[0.4, 0.1, 0.2, 0.3, 0.95]]
    assert report.measure(clip("c", "third_person", "dev", up=True, faces=big_face))[
        "viewpoint"] != "first_person"


def test_render_tables():
    clips = [clip("a", "first_person", "dev", True), clip("b", "third_person", "held_out", False),
             clip("c", None, "dev", True),
             data.ClipFeatures("d", "pexels:founder", "d", "third_person", "dev",
                               error="HTTP 403")]
    md = report.render(clips, "test", {"a": "overlays/a.jpg"})
    assert "| dev | 1 | 0.00 [0.00-0.79] (0/1) |" in md
    assert "| held_out | 0 | n/a | n/a | 1 | 0.00 [0.00-0.79] (0/1) |" in md
    assert "| pexels | unlabelled | 1 | 1 | 0 | 0 |" in md
    assert "`d` (HTTP 403)" in md and "![a]({IMAGE_BASE}overlays/a.jpg)" in md


def test_head_share_from_stored_hair_on_analysed_frames():
    c = clip("h", "third_person", "dev", up=True)
    assert report.heads_of(c) is None                      # features without the segmenter
    for i, f in enumerate(c.frames):
        f.hair = (0.1 if i % 4 == 0 else 0.0) if i % 2 == 0 else None
    assert report.heads_of(c) == 0.5
    assert report.measure(c)["viewpoint"] == "uncertain"   # head in half the frames
