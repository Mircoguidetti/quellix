import io
import tarfile

import httpx
import pytest

from quellix_eval.benchmark.remote_tar import RangeReader, load_or_walk, walk


def _tar(fmt: int) -> bytes:
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w", format=fmt) as t:
        for name, data in [
            ("R007-7July-DSLR/Export_py/Video_pitchshift.mp4", b"v" * 1500),
            ("R007-7July-DSLR/Export_py/Hands/Left_sync.txt", b"left\n"),
            ("z" * 40 + "/" + "deep/" * 30 + "Video/Pose_sync.txt", b"pose" * 300),
            ("empty.txt", b""),
        ]:
            info = tarfile.TarInfo(name)
            info.size = len(data)
            t.addfile(info, io.BytesIO(data))
    return buf.getvalue()


def _client(blob: bytes, calls: list[str]) -> httpx.Client:
    def handler(request: httpx.Request) -> httpx.Response:
        rng = request.headers["range"].removeprefix("bytes=")
        a, b = (int(x) for x in rng.split("-"))
        calls.append(rng)
        if a >= len(blob):
            return httpx.Response(416)
        return httpx.Response(206, content=blob[a:b + 1])

    return httpx.Client(transport=httpx.MockTransport(handler))


@pytest.mark.parametrize("fmt", [tarfile.GNU_FORMAT, tarfile.PAX_FORMAT])
def test_walk_indexes_members_and_reads_them_back(fmt, tmp_path):
    blob = _tar(fmt)
    calls: list[str] = []
    reader = RangeReader("https://x/data.tar", _client(blob, calls))
    index = walk(reader)
    long = next(n for n in index if n.endswith("Video/Pose_sync.txt"))
    assert len(long) > 100                         # long names survive (GNU 'L' / pax)
    m = index["R007-7July-DSLR/Export_py/Video_pitchshift.mp4"]
    assert reader.read(m.offset, m.size) == b"v" * 1500
    reader.copy_to(m.offset, m.size, tmp_path / "v.mp4", chunk=700)
    assert (tmp_path / "v.mp4").read_bytes() == b"v" * 1500
    assert reader.read(index[long].offset, index[long].size) == b"pose" * 300
    assert index["empty.txt"].size == 0


def test_ustar_prefix_names_and_keep_filter():
    buf = io.BytesIO()
    name = "a" * 90 + "/" + "b" * 60 + "/Left_sync.txt"   # fits ustar via the prefix field
    with tarfile.open(fileobj=buf, mode="w", format=tarfile.USTAR_FORMAT) as t:
        for n in (name, "other.bin"):
            info = tarfile.TarInfo(n)
            info.size = 3
            t.addfile(info, io.BytesIO(b"abc"))
    reader = RangeReader("https://x/u.tar", _client(buf.getvalue(), []))
    index = walk(reader, keep=lambda n: n.endswith("_sync.txt"))
    assert list(index) == [name]


def test_index_is_cached(tmp_path):
    blob = _tar(tarfile.GNU_FORMAT)
    calls: list[str] = []
    reader = RangeReader("https://x/data.tar", _client(blob, calls))
    first = load_or_walk(reader, tmp_path / "idx.json")
    n = len(calls)
    assert load_or_walk(reader, tmp_path / "idx.json") == first
    assert len(calls) == n                          # second load did not touch the network
    other = RangeReader("https://x/other.tar", _client(blob, calls))
    load_or_walk(other, tmp_path / "idx.json")      # a different URL invalidates the cache
    assert len(calls) > n


def test_server_ignoring_range_is_an_error():
    ignore = httpx.MockTransport(lambda r: httpx.Response(200, content=b"x"))
    client = httpx.Client(transport=ignore)
    with pytest.raises(RuntimeError, match="ignored the Range"):
        RangeReader("https://x/a.tar", client, retries=0).read(512, 512)
