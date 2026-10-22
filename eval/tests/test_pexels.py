import json

import numpy as np
import pytest
from test_site_clips import SKIN, FakeHands, decision

from quellix_eval import site_clips as sc
from quellix_eval.datasets import pexels as px
from quellix_eval.defects import make_clean_clip, write_video

PAGE = """
<html><script type="application/ld+json">{"@type":"VideoObject","author":{"@type":"Person",
"name":"Ada Lens","url":"https://www.pexels.com/@ada"}}</script>
<video><source src="https://videos.pexels.com/video-files/7308220/7308220-sd_640_360_25fps.mp4">
<source src="https://videos.pexels.com/video-files/7308220/7308220-hd_1920_1080_25fps.mp4">
<source src="https://videos.pexels.com/video-files/7308220/7308220-uhd_3840_2160_25fps.mp4">
<source src="https://videos.pexels.com/video-files/9999999/9999999-hd_1280_720_25fps.mp4"></video>
</html>"""


def test_page_parsing_and_rendition_choice():
    options = px.renditions_from_page(PAGE, 7308220)
    assert [(r.width, r.height) for r in options] == [(640, 360), (1920, 1080), (3840, 2160)]
    assert px.best_rendition(options, "landscape").width == 1920      # not the 4K file
    assert px.best_rendition(options, "portrait") is None
    tall = [px.Rendition("u1", 1080, 1920), px.Rendition("u2", 720, 1280),
            px.Rendition("u3", 2160, 3840)]
    assert px.best_rendition(tall, "portrait").url == "u1"
    meta = px.meta_from_page(PAGE, "https://p/")
    assert (meta.author, meta.author_url) == ("Ada Lens", "https://www.pexels.com/@ada")
    assert px.meta_from_page("<html></html>", "https://p/").author.startswith("unknown")


class FakeNet:
    def __init__(self, page=PAGE, fail=()):
        self.page, self.fail, self.downloads = page, tuple(fail), []

    def get(self, url, headers=None):
        if "api.pexels.com" in url:
            if "api" in self.fail:
                raise OSError("api down")
            user = {"name": "Api Name", "url": "https://www.pexels.com/@api"}
            return json.dumps({"url": "https://www.pexels.com/video/x/", "user": user,
                               "video_files": [
                {"file_type": "video/mp4", "width": 1920, "height": 1080, "link": "https://v/api.mp4"},
                {"file_type": "video/mp4", "width": 640, "height": 360, "link": "https://v/low.mp4"},
            ]}).encode()
        if "page" in self.fail:
            raise OSError("HTTP Error 403: Forbidden")
        return self.page.encode()

    def download(self, url, dst, headers=None):
        self.downloads.append(url)
        if any(f in url for f in self.fail if f != "page"):
            raise OSError(f"HTTP Error 403 for {url}")
        dst.parent.mkdir(parents=True, exist_ok=True)
        dst.write_bytes(b"x" * 60_000)


PICK = px.PICKS[0]


def test_fetch_pick_uses_the_page_link_first(tmp_path):
    net = FakeNet()
    path, meta = px.fetch_pick(net, PICK, tmp_path, log=lambda s: None)
    assert path.exists() and meta.author == "Ada Lens"
    assert net.downloads == ["https://videos.pexels.com/video-files/7308220/"
                             "7308220-hd_1920_1080_25fps.mp4"]


def test_fetch_pick_falls_back_to_the_download_endpoint_then_the_api(tmp_path):
    net = FakeNet(fail=("videos.pexels.com",))
    path, _ = px.fetch_pick(net, PICK, tmp_path, log=lambda s: None)
    assert path.exists() and net.downloads[-1] == "https://www.pexels.com/download/video/7308220/"
    net = FakeNet(fail=("videos.pexels.com", "download/video"))
    path, meta = px.fetch_pick(net, PICK, tmp_path, api_key="k", log=lambda s: None)
    assert net.downloads[-1] == "https://v/api.mp4" and meta.author == "Api Name"


def test_fetch_pick_reports_every_exact_error(tmp_path):
    net = FakeNet(fail=("page", "videos.pexels.com", "download/video"))
    with pytest.raises(RuntimeError) as e:
        px.fetch_pick(net, PICK, tmp_path, log=lambda s: None)
    msg = str(e.value)
    assert "HTTP Error 403: Forbidden" in msg and "download/video/7308220" in msg
    assert "PEXELS_API_KEY is not set" in msg


def test_the_final_list_is_the_founders():
    assert [p.pexels_id for p in px.PICKS] == [
        7308220, 4520150, 11102752, 5592524, 4440711, 7641501, 9141844]
    assert [p.orientation for p in px.PICKS].count("portrait") == 2


def test_fetch_pexels_keeps_going_after_one_failure(tmp_path):
    class Flaky(FakeNet):
        def download(self, url, dst, headers=None):
            if "4520150" in url:
                raise OSError("boom")
            super().download(url, dst, headers)

    got, errors = sc.fetch_pexels(Flaky(page=PAGE), tmp_path, px.PICKS[:2], log=lambda s: None)
    assert [g.clip_id for g in got] == ["pexels_7308220"] and len(errors) == 1
    assert "pexels_4520150" in errors[0] and "boom" in errors[0]
    s = got[0].source
    assert s.fixed and s.key == "pexels" and s.author == "Ada Lens" and s.orientation == "landscape"


# --- site clips from hand-picked sources -------------------------------------------------


def source_video(tmp_path, name, portrait=False, n=36, seed=1):
    c = make_clean_clip(n_frames=n, size=(72, 128), fps=12.0, seed=seed)
    h, w = c.frames[0].shape[:2]
    ramp = np.linspace(-45, 45, w, dtype=np.int16)[None, :, None]
    frames = []
    for f in c.frames:
        skin = (np.abs(f.astype(int) - SKIN).max(axis=2) < 40)[..., None]
        shifted = np.clip(f.astype(np.int16) + ramp, 0, 255).astype(np.uint8)
        frames.append(np.where(skin, f, shifted))
    if portrait and w > h:
        frames = [np.ascontiguousarray(np.rot90(f)) for f in frames]
    p = tmp_path / f"{name}.mp4"
    write_video(p, frames, c.fps)
    return p


def info(name="x", portrait=False):
    return sc.SourceInfo("pexels", "Pexels", "Pexels License", name, "Folding", 0.0, (),
                         f"https://www.pexels.com/video/{name}/", "Ada Lens",
                         "https://www.pexels.com/@ada", "portrait" if portrait else "landscape",
                         fixed=True)


def label_worker(rejected=()):
    def check(video, rubric):
        d = decision(label="reject" if any(r in video.name for r in rejected) else "accept")
        if d["decision"] == "reject":
            d["reasons"] = [{"check": "privacy", "code": "privacy.face", "effect": "reject",
                             "message": "A face is visible."}]
        return d

    return check


def test_fixed_source_only_needs_the_worker_not_to_reject(tmp_path):
    ok = sc.analyse("pexels_1", source_video(tmp_path, "ok"), FakeHands(), label_worker(),
                    sc.DEFAULT_RUBRIC, source=info())
    assert sc.eligibility(ok) is None
    bad = sc.analyse("pexels_2", source_video(tmp_path, "face"), FakeHands(),
                     label_worker(("face",)), sc.DEFAULT_RUBRIC, source=info())
    reason = sc.eligibility(bad)
    assert "would reject" in reason and "A face is visible." in reason
    assert sc.select_picks([ok, bad], n=5) == [ok]
    assert bad.rejected == reason


def test_a_short_clip_is_used_whole_not_padded(tmp_path):
    p = source_video(tmp_path, "short", n=24)           # 2 s, shorter than the 9 s window
    c = sc.analyse("pexels_5", p, FakeHands(), label_worker(), sc.DEFAULT_RUBRIC, source=info())
    duration = sc.video_info(p)[0]
    assert c.window is not None and c.window.start_s == 0.0
    assert c.window.end_s == pytest.approx(duration)


def test_hand_picked_clips_keep_their_order(tmp_path):
    cs = [sc.analyse(f"pexels_{i}", source_video(tmp_path, f"c{i}", seed=i), FakeHands(),
                     label_worker(), sc.DEFAULT_RUBRIC, source=info(f"c{i}")) for i in (3, 1, 2)]
    assert [c.clip_id for c in sc.select_picks(cs, n=5)] == ["pexels_3", "pexels_1", "pexels_2"]


def test_portrait_clips_stay_portrait_and_are_capped_at_720(tmp_path, monkeypatch):
    monkeypatch.setattr(sc, "PORTRAIT_WIDTH", 40)
    p = source_video(tmp_path, "tall", portrait=True)
    h, w = sc.video_info(p)[2], sc.video_info(p)[1]
    assert h > w
    c = sc.analyse("pexels_6", p, FakeHands(), label_worker(), sc.DEFAULT_RUBRIC,
                   source=info(portrait=True))
    out = tmp_path / "out"
    out.mkdir()
    files = sc.render_clip(c, "clip-01", out, width=1280)
    assert files["height"] > files["width"] and files["width"] <= 40


def test_produce_drops_a_clip_the_worker_rejects_and_adds_defective_copies(tmp_path, monkeypatch):
    monkeypatch.setattr(sc, "DEFECT_SECONDS", 1.0)
    worker_calls, dropped = [], []

    def worker(video, rubric):
        worker_calls.append(video.name)
        if "-hand" in video.name:            # the worker flags the hand defect, not the dark one
            d = decision(label="review")
            d["reasons"] = [{"check": "hands_visible", "code": "hands_visible.below_min",
                             "effect": "review", "message": "Hands leave the frame.",
                             "hint": "Keep both hands in frame.",
                             "segments": [{"start_s": 0.5, "end_s": 1.5}]}]
            return d
        if worker_calls.count(video.name) == 1 and video.name == "clip-02.mp4" and not dropped:
            dropped.append(video.name)          # the first delivered "clip-02" gets rejected
            return label_worker(("clip-02",))(video, rubric)
        return decision()

    cands = [sc.analyse(f"pexels_{i}", source_video(tmp_path, f"s{i}", seed=i), FakeHands(),
                        label_worker(), sc.DEFAULT_RUBRIC, source=info(f"s{i}"))
             for i in (1, 2, 3)]
    final = tmp_path / "final"
    manifest = sc.produce(cands, FakeHands(), worker, sc.DEFAULT_RUBRIC, final, picks_wanted=3,
                          width=160, variants_of=1)
    ids = [c["id"] for c in manifest["clips"]]
    # the second delivered cut is rejected by the worker: dropped, the third takes its number
    assert ids == ["clip-01", "clip-01-hand", "clip-01-dark", "clip-02"]
    assert cands[1].rejected.startswith("the worker rejects the delivered cut")
    assert manifest["clips"][-1]["source_clip"] == "pexels_3"
    assert not list(final.glob("clip-03*"))
    hand = json.loads((final / "clip-01-hand.json").read_text())
    assert hand["decision"]["reasons"][0]["hint"] == "Keep both hands in frame."   # untouched
    assert hand["decision"]["reasons"][0]["segments"] == [{"start_s": 0.5, "end_s": 1.5}]
    assert hand["variant"]["of"] == "clip-01" and hand["variant"]["kind"] == "hand"
    assert hand["variant"]["tried"][0]["decision"] == "review"       # first recipe already flagged
    dark = json.loads((final / "clip-01-dark.json").read_text())
    assert [t["recipe"] for t in dark["variant"]["tried"]][-1] == dark["variant"]["recipe"]
    assert len(dark["variant"]["tried"]) == 3        # none flagged: the strongest is kept
    entry = {c["id"]: c for c in manifest["clips"]}["clip-01-hand"]
    assert entry["variant_of"] == "clip-01" and entry["author"] == "Ada Lens"
    assert entry["page_url"].startswith("https://www.pexels.com/")


def test_author_from_the_other_formats_pexels_pages_use():
    graph = ('<script type="application/ld+json">{"@graph":[{"@type":"WebPage"},{"@type":'
             '"VideoObject","creator":{"@type":"Person","name":"Bo Frame",'
             '"url":"https://www.pexels.com/@bo"}}]}</script>')
    assert px.meta_from_page(graph, "p").author == "Bo Frame"
    data = ('<script>{"user":{"id":1,"first_name":"Cy","last_name":"Reel",'
            '"username":"cyreel"}}</script>')
    meta = px.meta_from_page(data.replace('"', '\\"'), "p")          # embedded as an escaped string
    assert (meta.author, meta.author_url) == ("Cy Reel", "https://www.pexels.com/@cyreel")
    links = '<a href="/@dee">x</a><a href="/@dee/">y</a><a href="/@other">z</a>'
    assert px.meta_from_page(links, "p").author == "@dee"
    none = px.meta_from_page('<html><body>hello "creator": 3</body></html>', "p")
    assert none.author.startswith("unknown") and "creator" in none.debug
