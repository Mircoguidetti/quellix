import json
from urllib.parse import parse_qs, urlparse

import pytest

from quellix_eval.datasets import pixabay as pb


def hit(i, duration=12, small=True):
    v = {"tiny": {"url": f"https://cdn/{i}-tiny.mp4", "width": 640, "height": 360}}
    if small:
        v["small"] = {"url": f"https://cdn/{i}-small.mp4", "width": 960, "height": 540}
    return {"id": i, "pageURL": f"https://pixabay.com/videos/x-{i}/", "tags": "face, woman",
            "duration": duration, "videos": v}


class FakeNet:
    def __init__(self, hits):
        self.hits, self.urls, self.downloads = hits, [], []

    def get(self, url):
        self.urls.append(url)
        q = parse_qs(urlparse(url).query)
        if "id" in q:
            found = [h for h in self.hits if str(h["id"]) == q["id"][0]]
            return json.dumps({"hits": found}).encode()
        return json.dumps({"hits": self.hits}).encode()

    def download(self, url, dst):
        self.downloads.append(url)
        dst.parent.mkdir(parents=True, exist_ok=True)
        dst.write_bytes(b"x" * 20_000)


def test_search_skips_long_and_excluded_and_prefers_the_small_rendition():
    net = FakeNet([hit(1, duration=90), hit(2), hit(3, small=False), hit(4)])
    out = pb.search(net, "KEY", "woman face", 2, exclude=[4])
    assert [h.pixabay_id for h in out] == [2, 3]
    assert out[0].video_url.endswith("2-small.mp4") and out[1].video_url.endswith("3-tiny.mp4")
    q = parse_qs(urlparse(net.urls[0]).query)
    assert q["q"] == ["woman face"] and q["safesearch"] == ["true"] and q["key"] == ["KEY"]
    assert out[0].clip_id == "pixabay_2"


def test_by_id_and_fetch(tmp_path):
    net = FakeNet([hit(7)])
    h = pb.by_id(net, "K", 7)
    p = pb.fetch(net, h, tmp_path)
    assert p.name == "pixabay_7.mp4" and p.exists()
    pb.fetch(net, h, tmp_path)
    assert len(net.downloads) == 1  # cached
    with pytest.raises(RuntimeError, match="not found"):
        pb.by_id(net, "K", 8)
