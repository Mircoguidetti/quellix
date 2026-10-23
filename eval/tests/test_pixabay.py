import json

from quellix_eval.datasets import pixabay as pb

HIT = {"id": 123, "pageURL": "https://pixabay.com/videos/x-123/", "tags": "kitchen, cooking",
       "duration": 14,
       "videos": {"large": {"url": "L", "width": 1920, "height": 1080},
                  "medium": {"url": "M", "width": 1280, "height": 720},
                  "small": {"url": "S", "width": 640, "height": 360},
                  "tiny": {"url": "T", "width": 320, "height": 180}}}


class FakeNet:
    def __init__(self, pages):
        self.pages, self.urls = pages, []

    def get(self, url, headers=None):
        self.urls.append(url)
        q = url.split("q=")[1].split("&")[0]
        return json.dumps({"hits": self.pages.get(q, [])}).encode()


def test_smallest_rendition_that_is_big_enough():
    assert pb.pick_rendition(HIT["videos"]) == ("S", 640, 360)
    assert pb.pick_rendition({"tiny": {"url": "T", "width": 320, "height": 180}}) == (
        "T", 320, 180)
    assert pb.pick_rendition({}) is None


def test_parse_skips_long_videos_and_keeps_the_query():
    long = {**HIT, "id": 9, "duration": 300}
    (h,) = pb.parse_hits(json.dumps({"hits": [HIT, long]}), "cooking")
    assert h.clip_id == "pixabay_123" and h.query == "cooking" and h.url == "S"


def test_search_dedupes_and_limits_per_query():
    other = {**HIT, "id": 124}
    net = FakeNet({"a": [HIT, other], "b": [HIT]})
    hits = pb.search(net, "KEY", ["a", "b"], per_query=1)
    assert [h.pixabay_id for h in hits] == [123]
    assert [h.pixabay_id for h in pb.search(net, "KEY", ["a"], 5, skip={123})] == [124]
    assert "key=KEY" in net.urls[0] and "video_type=film" in net.urls[0]
