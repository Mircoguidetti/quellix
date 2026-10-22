import io
import json
import tarfile
from pathlib import Path

import pytest

from quellix_eval import site_clips as sc
from quellix_eval.datasets import holoassist_stream as ha
from quellix_eval.defects import make_clean_clip, write_video


def build_tar(files, fmt=tarfile.GNU_FORMAT):
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w", format=fmt) as t:
        d = tarfile.TarInfo("R007-7July-DSLR")
        d.type = tarfile.DIRTYPE
        t.addfile(d)
        for name, data in files.items():
            info = tarfile.TarInfo(name)
            info.size = len(data)
            t.addfile(info, io.BytesIO(data))
    return buf.getvalue()


class MemHttp:
    """Serves bytes with range semantics and counts what was read."""

    def __init__(self, blobs):
        self.blobs, self.read_bytes, self.calls = blobs, 0, 0

    def size(self, url):
        return len(self.blobs[url])

    def read(self, url, start, length):
        self.calls += 1
        data = self.blobs[url][start : start + length]
        self.read_bytes += len(data)
        return data

    def download(self, url, start, length, dst):
        dst.parent.mkdir(parents=True, exist_ok=True)
        dst.write_bytes(self.read(url, start, length))


LONG = "R100-9July-Nespresso/Export_py/" + "x" * 120 + "/Video_pitchshift.mp4"


def fake_tar():
    return build_tar({
        "R007-7July-DSLR/Export_py/Video_pitchshift.mp4": b"a" * 3000,
        "R007-7July-DSLR/Export_py/notes.txt": b"hello",
        LONG: b"b" * 70_000,
        "R012-7July-Nespresso/Export_py/Video_pitchshift.mp4": b"c" * 1500,
    })


def test_list_tar_reads_headers_only_and_handles_long_names():
    data = fake_tar()
    http = MemHttp({"u": data})
    entries = ha.list_tar(http, "u")
    names = [e.name for e in entries]
    assert LONG in names and "R007-7July-DSLR/Export_py/notes.txt" in names
    big = next(e for e in entries if e.name == LONG)
    assert data[big.offset : big.offset + big.size] == b"b" * 70_000         # offsets are exact
    assert http.read_bytes < len(data) / 3                                    # never the whole tar


def test_list_tar_stops_at_max_entries_and_time_budget():
    http = MemHttp({"u": fake_tar()})
    assert len(ha.list_tar(http, "u", max_entries=2)) == 2
    t = iter([0.0, 0.0, 999.0, 999.0, 999.0])
    assert len(ha.list_tar(http, "u", max_seconds=10, clock=lambda: next(t))) <= 1


def test_list_tar_with_pax_headers():
    data = build_tar({"R050-1July-Nespresso/" + "y" * 150 + ".mp4": b"z" * 600},
                     fmt=tarfile.PAX_FORMAT)
    entries = ha.list_tar(MemHttp({"u": data}), "u")
    assert entries[-1].name.endswith("y" * 150 + ".mp4") and entries[-1].size == 600


def test_task_and_pick_recordings_spread_over_tasks():
    assert ha.task_of("R007-7July-DSLR") == "DSLR" and ha.task_of("odd") == "odd"
    entries = [ha.TarEntry(f"R{i:03d}-1July-{t}/Export_py/Video_pitchshift.mp4", i, 100)
               for t in ("DSLR", "Nespresso", "Printer") for i in range(10)]
    entries += [ha.TarEntry("R999-1July-DSLR/Export_py/Video_pitchshift.mp4", 0, 10**10),
                ha.TarEntry("R001-1July-DSLR/Export_py/notes.txt", 0, 5)]
    picks = ha.pick_recordings(entries, 6)
    assert len(picks) == 6 and {p.task for p in picks} == {"DSLR", "Nespresso", "Printer"}
    assert all(p.size <= 400_000_000 and p.name.endswith(".mp4") for p in picks)
    assert len({p.name for p in picks}) == 6
    assert len(ha.pick_recordings(entries[:2], 10)) == 2
    assert ha.pick_recordings([], 3) == []


def test_annotations_to_steps():
    sessions = [{"video_name": "R007-7July-DSLR/Export_py", "taskType": "dslr", "events": [
        {"label": "Conversation", "start": 0, "end": 5},
        {"label": "Fine grained action", "start": 6, "end": 9,
         "attributes": {"Verb": "grab", "Direct Object": "lens"}},
        {"label": "Fine grained action", "start": 3, "end": 5, "attributes": {"Verb": "open"}},
        {"label": "Fine grained action", "start": 9, "end": 9},
    ]}]
    s = ha.session_for(sessions, "R007-7July-DSLR")
    assert s and s["taskType"] == "dslr" and ha.session_for(sessions, "nope") is None
    steps = ha.action_steps(s)
    assert [x["name"] for x in steps] == ["open", "grab lens"] and ha.action_steps(None) == []
    clip = ha.steps_in_window(steps, 4.0, 8.0)
    assert clip == [
        {"name": "open", "t_s": 0.0, "end_s": 1.0, "source": "HoloAssist annotation"},
        {"name": "grab lens", "t_s": 2.0, "end_s": 4.0, "source": "HoloAssist annotation"}]


def tiny_mp4(tmp_path, name, seed):
    c = make_clean_clip(n_frames=36, size=(72, 128), fps=12.0, seed=seed)
    p = tmp_path / name
    write_video(p, c.frames, c.fps)
    return p.read_bytes()


def test_fetch_holoassist_streams_only_the_chosen_recordings(tmp_path):
    vids = {
        "R007-7July-DSLR/Export_py/Video_pitchshift.mp4": tiny_mp4(tmp_path, "a.mp4", 1),
        "R012-7July-Nespresso/Export_py/Video_pitchshift.mp4": tiny_mp4(tmp_path, "b.mp4", 2),
    }
    annotations = [{"video_name": "R007-7July-DSLR", "taskType": "dslr", "events": [
        {"label": "Fine grained action", "start": 1, "end": 2,
         "attributes": {"Verb": "grab", "Direct Object": "lens"}}]}]
    http = MemHttp({ha.VIDEO_TAR: build_tar(vids),
                    ha.ANNOTATIONS: json.dumps(annotations).encode()})
    got = sc.fetch_holoassist(http, tmp_path / "out", n=2, seconds=2.0, start_s=0.5, width=128,
                              log=lambda s: None)
    assert {f.clip_id for f in got} == {"holoassist_R007-7July-DSLR",
                                        "holoassist_R012-7July-Nespresso"}
    dslr = next(f for f in got if "DSLR" in f.clip_id)
    assert dslr.path.exists() and dslr.source.task == "dslr" and dslr.source.offset_s == 0.5
    assert dslr.source.license == "CDLA-Permissive-2.0" and dslr.source.key == "holoassist"
    assert dslr.source.annotated_steps[0]["name"] == "grab lens"
    assert not list((tmp_path / "out" / "holoassist-raw").glob("*.mp4"))      # raw files removed


def test_fetch_holoassist_reports_the_exact_error_when_unreachable(tmp_path):
    class Down:
        def size(self, url):
            raise RuntimeError("HEAD https://hl2data.example/x.tar failed after 4 tries: HTTP 403")

    with pytest.raises(RuntimeError, match="HTTP 403"):
        sc.fetch_holoassist(Down(), tmp_path, n=2, log=lambda s: None)


def test_fetch_holoassist_survives_missing_annotations_and_a_broken_recording(tmp_path):
    vids = {"R001-1July-DSLR/Export_py/Video_pitchshift.mp4": b"not a video at all",
            "R002-1July-DSLR/Export_py/Video_pitchshift.mp4": tiny_mp4(tmp_path, "g.mp4", 3)}
    http = MemHttp({ha.VIDEO_TAR: build_tar(vids)})     # no annotation file served
    got = sc.fetch_holoassist(http, tmp_path / "out", n=2, seconds=2.0, start_s=0.0, width=128,
                              log=lambda s: None)
    assert [f.clip_id for f in got] == ["holoassist_R002-1July-DSLR"]
    assert got[0].source.annotated_steps == () and got[0].source.task == "DSLR"
    assert isinstance(Path(got[0].path), Path)
