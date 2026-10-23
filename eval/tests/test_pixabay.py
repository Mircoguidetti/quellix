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


def test_throttle_spaces_calls_and_retries_429():
    import urllib.error

    t = [0.0]
    slept = []

    def sleep(s):
        slept.append(round(s, 2))
        t[0] += s

    class Flaky:
        def __init__(self):
            self.n = 0

        def get(self, url):
            self.n += 1
            if self.n == 2:
                raise urllib.error.HTTPError(url, 429, "Too Many Requests", {}, None)
            return b"{}"

    net = pb.Throttled(Flaky(), interval=1.0, pause=10.0, sleep=sleep, clock=lambda: t[0])
    assert net.get("a") == b"{}"
    assert net.get("b") == b"{}"           # 2nd call: 429, pause, retried
    assert slept == [1.0, 10.0]
    assert net.inner.n == 3


def test_throttle_gives_up_after_the_retries():
    import urllib.error

    import pytest

    class Always429:
        def get(self, url):
            raise urllib.error.HTTPError(url, 429, "Too Many Requests", {}, None)

    net = pb.Throttled(Always429(), interval=0, retries=2, pause=0, sleep=lambda s: None)
    with pytest.raises(urllib.error.HTTPError):
        net.get("x")
