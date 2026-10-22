"""Extract viewpoint features from labelled clips (runs in Actions; #79).

    python -m quellix_eval.viewpoint.extract --out out/viewpoint \\
        --features reports/viewpoint/features.jsonl.gz --sheets reports/viewpoint/candidates \\
        --ego10k 60 --holoassist 30 --candidates 30

For every clip: the worker's own decode, the real hands model's landmarks (per sampled frame),
YuNet faces (the privacy check's detector) and the global camera shift of every motion pair.
Pexels search results are extracted too, unlabelled, with a contact sheet each so a person can
label them. Videos are never committed; only the small feature file and the sheets are.
"""

from __future__ import annotations

import argparse
import os
import re
import sys
import tempfile
import time
from collections.abc import Callable, Sequence
from pathlib import Path

import cv2
import numpy as np

from .data import (
    PEXELS_EXTRA,
    PEXELS_FOUNDER,
    SEARCHES,
    ClipFeatures,
    FrameFeat,
    PexelsLabel,
    hand_feats,
    motion_of,
    save,
    split_of,
)

_LINK = re.compile(r"/video/([a-z0-9-]+?)-(\d{5,})/")


def search_ids(html: str) -> list[tuple[str, int]]:
    """(slug, id) of the videos a Pexels search page links to, in page order."""
    seen: dict[int, str] = {}
    for slug, vid in _LINK.findall(html):
        seen.setdefault(int(vid), slug)
    return [(s, i) for i, s in seen.items()]


class Extractor:  # pragma: no cover - needs the real models
    def __init__(self) -> None:
        from quellix_hands.model import HandsModel
        from quellix_worker.checks.privacy import YuNetFaceDetector

        self.hands = HandsModel()
        self.faces = YuNetFaceDetector()

    def __call__(self, path: Path, clip: ClipFeatures) -> ClipFeatures:
        from quellix_worker import media

        v = media.decode(path)
        if not v.info.decodable or not v.frames:
            clip.error = "not decodable"
            return clip
        clip.width, clip.height, clip.duration_s = v.info.width, v.info.height, v.info.duration_s
        per_frame = self.hands.frames([f.rgb for f in v.frames], [f.t_s for f in v.frames])
        for f, fh in zip(v.frames, per_frame, strict=True):
            faces = [[round(x, 3) for x in b] for b in self.faces.detect(f.rgb)]
            clip.frames.append(FrameFeat(round(f.t_s, 2), hand_feats(fh), faces))
        clip.motion = motion_of(v.motion_pairs)
        return clip


def contact_sheet(path: Path, dst: Path, title: str, n: int = 4, width: int = 220) -> None:
    from quellix_worker import media

    v = media.decode(path)
    if not v.frames:
        return
    idx = np.linspace(0, len(v.frames) - 1, n).round().astype(int)
    tiles = []
    for i in idx:
        rgb = v.frames[int(i)].rgb
        h, w = rgb.shape[:2]
        tiles.append(cv2.resize(rgb, (width, round(h * width / w)), interpolation=cv2.INTER_AREA))
    hmax = max(t.shape[0] for t in tiles)
    tiles = [np.pad(t, ((0, hmax - t.shape[0]), (0, 2), (0, 0)), constant_values=255)
             for t in tiles]
    sheet = np.hstack(tiles)
    bar = np.full((22, sheet.shape[1], 3), 255, np.uint8)
    cv2.putText(bar, title, (4, 16), cv2.FONT_HERSHEY_SIMPLEX, 0.45, (0, 0, 0), 1, cv2.LINE_AA)
    dst.parent.mkdir(parents=True, exist_ok=True)
    cv2.imwrite(str(dst), cv2.cvtColor(np.vstack([bar, sheet]), cv2.COLOR_RGB2BGR),
                [cv2.IMWRITE_JPEG_QUALITY, 75])


def pexels_clips(net, labels: Sequence[PexelsLabel], work: Path, key: str,
                 extract: Callable[[Path, ClipFeatures], ClipFeatures]) -> list[ClipFeatures]:
    from ..datasets import pexels as px

    out = []
    for lab in labels:
        pick = px.Pick(lab.pexels_id, lab.slug, "", lab.orientation)
        clip = ClipFeatures(pick.clip_id, f"pexels:{lab.labelled_by}", pick.clip_id, lab.label,
                            split_of(pick.clip_id), note=lab.note)
        try:
            path, _ = px.fetch_pick(net, pick, work, key)
            extract(path, clip)
            path.unlink(missing_ok=True)
        except Exception as e:  # noqa: BLE001 - reported in the feature file
            clip.error = f"{type(e).__name__}: {e}"[:300]
        print(f"{clip.clip_id} {clip.label} frames={len(clip.frames)} {clip.error or ''}")
        out.append(clip)
    return out


def candidate_clips(net, n: int, known: set[int], work: Path, sheets: Path, key: str,
                    extract: Callable[[Path, ClipFeatures], ClipFeatures]) -> list[ClipFeatures]:
    from ..datasets import pexels as px

    found: list[tuple[str, int]] = []
    per_query = max(2, -(-n // len(SEARCHES)))
    for q in SEARCHES:
        try:
            html = net.get(f"https://www.pexels.com/search/videos/{q.replace(' ', '%20')}/")
            ids = [x for x in search_ids(html.decode("utf-8", "replace")) if x[1] not in known]
        except Exception as e:  # noqa: BLE001
            print(f"search {q!r}: {e}", file=sys.stderr)
            continue
        for slug, vid in ids[:per_query]:
            known.add(vid)
            found.append((slug, vid))
    out = []
    for slug, vid in found[:n]:
        pick = px.Pick(vid, slug, "", "landscape")
        clip = ClipFeatures(pick.clip_id, "pexels:candidate", pick.clip_id, None,
                            split_of(pick.clip_id), note=slug)
        try:
            path, _ = px.fetch_pick(net, pick, work, key)
            extract(path, clip)
            contact_sheet(path, sheets / f"{pick.clip_id}.jpg", f"{vid} {slug}"[:60])
            path.unlink(missing_ok=True)
        except Exception as e:  # noqa: BLE001
            clip.error = f"{type(e).__name__}: {e}"[:300]
        print(f"candidate {clip.clip_id} frames={len(clip.frames)} {clip.error or ''}")
        out.append(clip)
        time.sleep(1.0)
    return out


def ego10k_clips(n: int, work: Path, extract) -> list[ClipFeatures]:  # pragma: no cover
    from ..datasets import egocentric10k
    from ..datasets.manifest import load_manifest

    manifest = work / "ego10k.jsonl"
    egocentric10k.build(manifest, work / "ego10k", clips=n, min_factories=8)
    out = []
    for rec in load_manifest(manifest):
        group = rec.clip_id.rsplit("_", 1)[0]
        clip = ClipFeatures(rec.clip_id, "egocentric10k", group, "first_person", split_of(group))
        try:
            extract(Path(rec.path), clip)
        except Exception as e:  # noqa: BLE001
            clip.error = f"{type(e).__name__}: {e}"[:300]
        out.append(clip)
    return out


def holoassist_clips(n: int, work: Path, extract) -> list[ClipFeatures]:  # pragma: no cover
    import httpx

    from ..benchmark import holo
    from ..benchmark.media import cut

    client = httpx.Client(timeout=300, follow_redirects=True)
    ann = holo.load_annotations(client.get(holo.ANNOTATIONS_URL).raise_for_status().json())
    remote = holo.Remote(work / "holo-cache", client)
    vreader, vidx = remote.videos()
    out = []
    for session in holo.pick_sessions(sorted(ann), n, seed=79):
        member = holo.member_for(vidx, session, "Video_pitchshift.mp4")
        clip = ClipFeatures(f"holo_{session}", "holoassist", session, "first_person",
                            split_of(session))
        if member is None:
            continue
        try:
            with tempfile.TemporaryDirectory(dir=work) as td:
                src, dst = Path(td) / "v.mp4", Path(td) / "c.mp4"
                vreader.copy_to(member.offset, member.size, src)
                acts = holo.fine_actions(ann[session])
                mid = (acts[len(acts) // 2][0] if acts else 30.0)
                cut(src, dst, max(0.0, mid - 10), mid + 10)
                extract(dst, clip)
        except Exception as e:  # noqa: BLE001
            clip.error = f"{type(e).__name__}: {e}"[:300]
        print(f"{clip.clip_id} frames={len(clip.frames)} {clip.error or ''}")
        out.append(clip)
    return out


def main(argv: Sequence[str] | None = None) -> int:  # pragma: no cover - network
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawTextHelpFormatter)
    ap.add_argument("--out", type=Path, required=True)
    ap.add_argument("--features", type=Path, required=True)
    ap.add_argument("--sheets", type=Path, required=True)
    ap.add_argument("--ego10k", type=int, default=60)
    ap.add_argument("--holoassist", type=int, default=30)
    ap.add_argument("--candidates", type=int, default=30)
    a = ap.parse_args(argv)
    from ..datasets import pexels as px

    a.out.mkdir(parents=True, exist_ok=True)
    extract = Extractor()
    net = px.UrllibNet()
    key = os.environ.get("PEXELS_API_KEY", "")
    clips = pexels_clips(net, (*PEXELS_FOUNDER, *PEXELS_EXTRA), a.out / "pexels", key, extract)
    known = {lab.pexels_id for lab in (*PEXELS_FOUNDER, *PEXELS_EXTRA)}
    if a.candidates:
        clips += candidate_clips(net, a.candidates, known, a.out / "cand", a.sheets, key, extract)
    save(a.features, clips)       # partial results survive a later failure
    for name, n, fn in (("holoassist", a.holoassist, holoassist_clips),
                        ("egocentric10k", a.ego10k, ego10k_clips)):
        if not n:
            continue
        try:
            clips += fn(n, a.out / name, extract)
        except Exception as e:  # noqa: BLE001
            print(f"{name} failed: {type(e).__name__}: {e}", file=sys.stderr)
            clips.append(ClipFeatures(f"{name}_failed", name, name, None, "dev",
                                      error=f"{type(e).__name__}: {e}"[:500]))
        save(a.features, clips)
    ok = [c for c in clips if not c.error]
    print(f"{len(ok)}/{len(clips)} clips extracted")
    return 0


if __name__ == "__main__":  # pragma: no cover
    sys.exit(main())
