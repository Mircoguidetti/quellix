import json
import urllib.parse
from types import SimpleNamespace

import cv2
import numpy as np
import pytest

from quellix_eval import hero
from quellix_eval.defects import make_clean_clip, write_video


def _hit(i, w=1920, h=1080, dur=20.0, medium=True):
    videos = {"large": {"url": f"https://x/{i}-large.mp4", "width": w, "height": h},
              "small": {"url": f"https://x/{i}-small.mp4", "width": 640, "height": 360}}
    if medium:
        videos["medium"] = {"url": f"https://x/{i}-medium.mp4", "width": 1280, "height": 720}
    return {"id": i, "pageURL": f"https://pixabay.com/videos/{i}/", "user": f"u{i}",
            "tags": "dough, hands", "duration": dur, "videos": videos}


def test_search_url_asks_for_wide_videos():
    q = urllib.parse.parse_qs(urllib.parse.urlparse(hero.search_url("K", "kneading dough")).query)
    assert q["min_width"] == ["1920"] and q["q"] == ["kneading dough"]
    assert q["video_type"] == ["film"] and q["safesearch"] == ["true"]


def test_parse_hits_keeps_wide_landscape_10_to_60_s():
    raw = json.dumps({"hits": [
        _hit(1), _hit(2, w=1280, h=720), _hit(3, w=1080, h=1920), _hit(4, dur=8),
        _hit(5, dur=75), _hit(6, w=3840, h=2160, medium=False)]})
    hits = hero.parse_hits(raw, "q")
    assert [h.source_id for h in hits] == [1, 6]
    assert hits[0].url.endswith("1-medium.mp4") and hits[0].width == 1920
    assert hits[1].url.endswith("6-large.mp4") and hits[1].width == 3840
    assert hits[0].clip_id == "pixabay_1" and hits[0].author == "u1"


def test_search_dedupes_and_caps():
    pages = {"a": [_hit(1), _hit(2), _hit(3)], "b": [_hit(2), _hit(4)]}

    def get(url):
        q = urllib.parse.parse_qs(urllib.parse.urlparse(url).query)["q"][0]
        return json.dumps({"hits": pages[q]}).encode()

    hits = hero.search(get, "K", ["a", "b"], per_query=2, limit=10)
    assert [(h.source_id, h.query) for h in hits] == [(1, "a"), (2, "a"), (4, "b")]
    assert len(hero.search(get, "K", ["a", "b"], per_query=5, limit=2)) == 2


@pytest.mark.parametrize("m,why", [
    (hero.Measured(both_hands_whole=0.8, blur_ratio=0.02, viewpoint="first_person"), None),
    (hero.Measured(both_hands_whole=0.8, viewpoint="uncertain"), None),
    (hero.Measured(both_hands_whole=0.8), None),                       # viewpoint not measured
    (hero.Measured(both_hands_whole=0.5), "both hands"),
    (hero.Measured(both_hands_whole=None), "both hands"),
    (hero.Measured(both_hands_whole=0.9, confident_faces=3), "a face"),
    (hero.Measured(both_hands_whole=0.9, viewpoint="third_person"), "viewpoint"),
    (hero.Measured(both_hands_whole=0.9, blur_ratio=0.2), "blurry"),
    (hero.Measured(error="not decodable"), "not analysed"),
])
def test_verdict(m, why):
    got = hero.verdict(m)
    assert (got is None) if why is None else got.startswith(why)


def test_confident_faces_counts_frames_with_a_sure_face():
    frames = [[], [(0.1, 0.1, 0.1, 0.1, 0.95)], [(0.1, 0.1, 0.1, 0.1, 0.6)],
              [(0, 0, 0.1, 0.1, 0.5), (0, 0, 0.2, 0.2, 0.91)]]
    assert hero.confident_faces(frames) == 2


def test_viewpoint_probe_degrades_to_not_measured(tmp_path):
    fail = SimpleNamespace(returncode=1, stdout="", stderr="no such file")
    assert hero.viewpoint_probe(tmp_path / "x.mp4", src="",
                                run=lambda c, **k: fail)["viewpoint"] == "not measured"
    ok = SimpleNamespace(returncode=0, stdout='log\n{"viewpoint": "first_person", '
                         '"first_person_ratio": 0.9}\n', stderr="")
    calls = []

    def run(cmd, **kw):
        calls.append(kw["env"]["PYTHONPATH"])
        return ok

    out = hero.viewpoint_probe(tmp_path / "x.mp4", src="/vp/src", run=run)
    assert out == {"viewpoint": "first_person", "first_person_ratio": 0.9}
    assert calls[0].startswith("/vp/src")
    bad = SimpleNamespace(returncode=1, stdout="", stderr="ImportError: viewpoint")
    assert hero.viewpoint_probe(tmp_path / "x", src="/vp", run=lambda c, **k: bad) == {
        "viewpoint": "not measured", "note": "ImportError: viewpoint"}


def test_contact_sheet_is_a_titled_2x2_grid(tmp_path):
    clip = make_clean_clip(n_frames=40, size=(90, 160), fps=10.0)
    src = tmp_path / "c.mp4"
    write_video(src, clip.frames, clip.fps)
    frames = hero.sheet_frames(src)
    assert len(frames) == 4
    dst = tmp_path / "s" / "sheet.jpg"
    hit = hero.Hit("pixabay", 7, "p", "a", "t", 21.4, 3840, 2160, "u")
    m = hero.Measured(both_hands_whole=0.72, blur_ratio=0.01, viewpoint="first_person",
                      first_person_ratio=0.91)
    title = hero.sheet_title(hit, m)
    assert title == "pixabay_7  3840x2160  21s  hands 72%  blur 1%  first_person 0.91"
    hero.contact_sheet(frames, title, dst, cell_w=200)
    img = cv2.imread(str(dst))
    h, w = frames[0].shape[:2]
    assert img.shape == (40 + 2 * round(200 * h / w), 400, 3)
    with pytest.raises(ValueError):
        hero.contact_sheet([], "t", dst)


def _frame(t, left_full, right_full, contact=True):
    obs = lambda full: SimpleNamespace(state="full" if full else "truncated")  # noqa: E731
    return SimpleNamespace(t_s=t, left=obs(left_full), right=obs(right_full),
                           contact={"left": "portable_object" if contact else "none"})


def test_steadiest_window_prefers_sharp_frames_among_good_hand_windows():
    ts = np.arange(0, 30, 0.25)
    per_frame = [_frame(t, True, True) for t in ts]
    sharp = [10.0 if t < 15 else 200.0 for t in ts]      # the second half is steady
    a, b = hero.steadiest_window(per_frame, sharp, 9.0)
    assert a >= 15 and b - a == pytest.approx(9.0, abs=0.3)
    # a sharp stretch with poor hands is not chosen
    per_frame = [_frame(t, t < 15, True) for t in ts]
    a, _ = hero.steadiest_window(per_frame, sharp, 9.0)
    assert a < 15
    assert hero.steadiest_window(per_frame[:1], sharp[:1], 9.0) is None
    assert hero.window_stats(per_frame, 0, 5) == (1.0, 1.0)


def test_records_survivors_and_comment(tmp_path):
    hits = [hero.Hit("pixabay", i, f"https://pixabay.com/v/{i}", "u", "t", 20, 1920, 1080, "u",
                     "pour over coffee") for i in range(4)]
    ms = [hero.Measured(both_hands_whole=0.7), hero.Measured(both_hands_whole=0.9),
          hero.Measured(both_hands_whole=0.3), hero.Measured(both_hands_whole=0.8, blur_ratio=0.5)]
    recs = [hero.record_for(h, m, f"{h.clip_id}.jpg", hero.PIXABAY_LICENSE)
            for h, m in zip(hits, ms, strict=True)]
    assert [r.result for r in recs][:2] == ["candidate", "candidate"]
    assert recs[2].result.startswith("dropped: both hands")
    top = hero.survivors(recs)
    assert [r.clip_id for r in top] == ["pixabay_1", "pixabay_0"]
    pex = hero.record_for(hero.Hit("pexels", 15157114, "https://www.pexels.com/video/x-15157114/",
                                   "Someone", "Kneading dough", 30, 3840, 2160, "", "founder"),
                          hero.Measured(both_hands_whole=0.8, viewpoint="first_person"),
                          "pexels_15157114.jpg", "Pexels License")
    pex.site_clip = {"window_s": [3.0, 12.0], "window_choice": "steadiest good window",
                     "decision": "accept", "reasons": [], "both_hands_whole_in_window": 0.9,
                     "hands_ratio_both_manipulation": 0.88, "blur_ratio": 0.02, "faces": 0,
                     "viewpoint": "first_person", "poster": "pexels_15157114-poster.jpg"}
    text = hero.comment([*recs, pex], top, "https://github.com/o/r/raw/abc/eval/reports/h",
                        {"searched": 4, "pixabay": 4})
    assert "**2 candidates**" in text and "Dropped: blur: 1, hands: 1" in text
    assert "![pixabay_1](https://github.com/o/r/raw/abc/eval/reports/h/pixabay_1.jpg)" in text
    assert "worker **accept**" in text and "pexels_15157114-poster.jpg" in text
    assert text.index("Pexels picks") < text.index("Pixabay candidates")
    path = tmp_path / "t" / "c.jsonl"
    hero.write_jsonl([*recs, pex], path)
    rows = [json.loads(x) for x in path.read_text().splitlines()]
    assert len(rows) == 5 and rows[-1]["site_clip"]["decision"] == "accept"
    assert rows[0]["license"] == "Pixabay Content License"


def test_founder_picks_are_the_two_pexels_videos():
    picks = hero.founder_picks()
    assert [(p.pexels_id, p.orientation) for p in picks] == [(15157114, "landscape"),
                                                              (11142458, "portrait")]
    assert picks[0].page == ("https://www.pexels.com/video/"
                             "a-person-kneading-a-dough-on-the-table-15157114/")


def test_near_misses_are_hands_only_drops_between_30_and_60():
    def rec(i, **m):
        hit = hero.Hit("pixabay", i, f"p{i}", "u", "t", 20, 1920, 1080, "u")
        return hero.record_for(hit, hero.Measured(**m), f"pixabay_{i}.jpg", "L")

    recs = [rec(1, both_hands_whole=0.5), rec(2, both_hands_whole=0.35),
            rec(3, both_hands_whole=0.2), rec(4, both_hands_whole=0.55, confident_faces=5),
            rec(5, both_hands_whole=0.45, viewpoint="third_person"),
            rec(6, both_hands_whole=0.9)]
    assert [r.clip_id for r in hero.near_misses(recs, 5)] == ["pixabay_1", "pixabay_2"]
    assert hero.near_misses(recs, 0) == []
    text = hero.comment(recs, hero.survivors(recs), "B", {}, hero.near_misses(recs, 5))
    assert "Near misses (NOT passing" in text and "![pixabay_1](B/pixabay_1.jpg)" in text


def _f(t, left, right):
    obs = lambda st: SimpleNamespace(state=st)  # noqa: E731
    sides = {"left": obs(left), "right": obs(right)}
    return SimpleNamespace(t_s=t, hand=lambda s, d=sides: d[s])


def test_presence_window_picks_the_stretch_with_most_hands_in_view():
    ts = np.arange(0, 12, 0.25)
    frames = [_f(t, "truncated" if t >= 2.5 else "absent", "truncated") for t in ts]
    a, b = hero.presence_window(frames, 9.0)
    assert a >= 2.5 and b - a == pytest.approx(9.0, abs=0.3)
    assert hero.presence_window(frames[:1], 9.0) is None


def test_boxes_also_get_xywh_without_changing_the_format():
    side = {"hands": {"frames": [{"t": 0.0, "left": {"state": "full", "box": [0.1, 0.2, 0.4, 0.6]},
                                  "right": {"state": "absent", "box": None}}]}}
    out = hero.with_xywh(side)["hands"]["frames"][0]
    assert out["left"]["box"] == [0.1, 0.2, 0.4, 0.6]
    assert out["left"]["box_xywh"] == [0.1, 0.2, 0.3, 0.4]
    assert out["right"]["box_xywh"] is None
