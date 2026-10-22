"""Pexels clips for the website (Pexels License: free commercial use, no attribution required).

The founder picked five videos (issue #60). Each is downloaded in the Actions job, never
committed in full. A file URL comes from the public page (the `videos.pexels.com` links it
embeds, then the site's own download endpoint); if both fail and `PEXELS_API_KEY` is set, from
the Pexels API. Every network call goes through `Net`, so the tests run offline.
"""

from __future__ import annotations

import json
import re
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Protocol

DATASET = "Pexels"
LICENSE = "Pexels License"
UA = ("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) "
      "Chrome/124 Safari/537.36")


@dataclass(frozen=True)
class Pick:
    pexels_id: int
    slug: str
    task: str
    orientation: str          # "landscape" | "portrait"
    note: str = ""

    @property
    def page(self) -> str:
        return f"https://www.pexels.com/video/{self.slug}-{self.pexels_id}/"

    @property
    def clip_id(self) -> str:
        return f"pexels_{self.pexels_id}"


# The landing page's only clip (founder decision, issue #60): first-person footage, top-down,
# hands entering from the bottom. Landscape for the desktop hero; the mobile hero is a 9:16 crop.
LANDING = Pick(37443407, "whipping-cream-with-electric-mixer-in-bowl",
               "Whipping cream with an electric mixer", "landscape", "landing hero")

# Third-person / tripod footage the founder picked first. Not for the site (labs buy first-person
# video); kept as a test set for the gap we found: all our other tests are first-person.
THIRD_PERSON: tuple[Pick, ...] = (
    Pick(7308220, "a-woman-stacking-shirts", "Folding laundry", "landscape"),
    Pick(4520150, "man-putting-jeans-inside-the-box", "Packing jeans in a box", "landscape"),
    Pick(11102752, "close-up-on-person-cooking-in-pot", "Cooking in a pot", "landscape"),
    Pick(5592524, "person-cleaning-countertop-with-a-tissue", "Cleaning a countertop",
         "landscape"),
    Pick(4440711, "a-person-putting-clothes-on-the-washing-machine", "Loading a washing machine",
         "landscape"),
    Pick(7641501, "woman-washing-cups-in-the-sink", "Washing cups", "portrait"),
    Pick(9141844, "person-putting-folded-clothes-on-a-bag", "Putting folded clothes in a bag",
         "portrait"),
)
PICKS = (LANDING, *THIRD_PERSON)


class Net(Protocol):
    def get(self, url: str, headers: dict[str, str] | None = None) -> bytes: ...

    def download(self, url: str, dst: Path, headers: dict[str, str] | None = None) -> None: ...


class UrllibNet:  # pragma: no cover - network
    def __init__(self, timeout: float = 120.0) -> None:
        self.timeout = timeout

    def _open(self, url: str, headers: dict[str, str] | None):
        import urllib.request

        req = urllib.request.Request(url, headers={"User-Agent": UA, **(headers or {})})
        return urllib.request.urlopen(req, timeout=self.timeout)  # noqa: S310

    def get(self, url: str, headers: dict[str, str] | None = None) -> bytes:
        with self._open(url, headers) as r:
            return r.read()

    def download(self, url: str, dst: Path, headers: dict[str, str] | None = None) -> None:
        dst.parent.mkdir(parents=True, exist_ok=True)
        with self._open(url, headers) as r, open(dst, "wb") as f:
            while chunk := r.read(1 << 20):
                f.write(chunk)


@dataclass(frozen=True)
class Rendition:
    url: str
    width: int
    height: int


@dataclass(frozen=True)
class Meta:
    author: str
    author_url: str
    page: str
    debug: str = ""


_FILE = re.compile(
    r"https://videos\.pexels\.com/video-files/(\d+)/[^\"'\\\s<>]*?_(\d+)_(\d+)_[\d.]+fps\.mp4")


def renditions_from_page(html: str, pexels_id: int) -> list[Rendition]:
    """The mp4 files a Pexels video page links to (their names carry width and height)."""
    seen: dict[str, Rendition] = {}
    for m in _FILE.finditer(html.replace("\\u002F", "/").replace("\\/", "/")):
        if int(m.group(1)) == pexels_id:
            seen[m.group(0)] = Rendition(m.group(0), int(m.group(2)), int(m.group(3)))
    return list(seen.values())


def best_rendition(options: Sequence[Rendition], orientation: str) -> Rendition | None:
    """Landscape: the widest up to 1920 px. Portrait: the tallest up to 1920 px (>= 1280 wanted).

    The site shows 1280 px wide landscape clips and 720 px wide portrait ones, so more than
    1920 px on the long side is wasted download.
    """
    def long_side(r: Rendition) -> int:
        return max(r.width, r.height)

    portrait = orientation == "portrait"
    fits = [r for r in options
            if long_side(r) <= 1920 and (r.height > r.width) == portrait]
    if not fits:
        return None
    return max(fits, key=long_side)


def _find_person(node: object) -> tuple[str, str] | None:
    """(name, url) of the first author/creator in a parsed JSON-LD tree."""
    if isinstance(node, list):
        for item in node:
            if found := _find_person(item):
                return found
    elif isinstance(node, dict):
        for key in ("author", "creator"):
            person = node.get(key)
            if isinstance(person, list) and person:
                person = person[0]
            if isinstance(person, dict) and person.get("name"):
                return str(person["name"]), str(person.get("url") or "")
        for value in node.values():
            if isinstance(value, dict | list) and (found := _find_person(value)):
                return found
    return None


def meta_from_page(html: str, fallback_page: str) -> Meta:
    """Author name and profile link from the page, trying what Pexels is known to embed.

    1. JSON-LD (`author` / `creator`, at any depth);
    2. the page's data: a `user` object with first_name / last_name / username;
    3. the most linked profile (`/@handle`), shown as "@handle".
    When all fail the author is "unknown" and `debug` carries the page fragments to look at.
    """
    for block in re.findall(r'<script[^>]+application/ld\+json[^>]*>(.*?)</script>', html, re.S):
        try:
            found = _find_person(json.loads(block))
        except ValueError:
            continue
        if found:
            return Meta(found[0], found[1], fallback_page)
    flat = html.replace('\\"', '"')
    m = re.search(r'"first_name":"([^"]*)","last_name":"([^"]*)"', flat)
    handle = re.search(r'"(?:username|slug)":"([A-Za-z0-9._-]+)"', flat[m.end():m.end() + 400]
                       if m else "")
    if m and (m.group(1) or m.group(2)):
        name = f"{m.group(1)} {m.group(2)}".strip()
        return Meta(name, f"https://www.pexels.com/@{handle.group(1)}" if handle else "",
                    fallback_page)
    handles = re.findall(r'href="(?:https://www\.pexels\.com)?/@([A-Za-z0-9._-]+)/?"', html)
    if handles:
        top = max(set(handles), key=handles.count)
        return Meta(f"@{top}", f"https://www.pexels.com/@{top}", fallback_page)
    pattern = r'(?i)"(?:author|creator|photographer|first_name)"|/@\w'
    clues = [html[max(0, i.start() - 60): i.start() + 200].replace("\n", " ")
             for i in re.finditer(pattern, html)][:4]
    return Meta("unknown (see the Pexels page)", "", fallback_page,
                " || ".join(clues) or f"no author clue in {len(html)} bytes of page")


def api_rendition(net: Net, pexels_id: int, orientation: str, key: str) -> tuple[Rendition, Meta]:
    raw = net.get(f"https://api.pexels.com/videos/videos/{pexels_id}", {"Authorization": key})
    data = json.loads(raw)
    options = [Rendition(f["link"], int(f["width"]), int(f["height"]))
               for f in data.get("video_files", []) if f.get("file_type") == "video/mp4"
               and f.get("width") and f.get("height")]
    best = best_rendition(options, orientation)
    if best is None:
        raise RuntimeError(f"Pexels API: no suitable mp4 rendition for {pexels_id}")
    user = data.get("user") or {}
    return best, Meta(str(user.get("name") or "unknown"), str(user.get("url") or ""),
                      str(data.get("url") or ""))


def fetch_pick(
    net: Net, pick: Pick, out_dir: Path, api_key: str = "", log: Callable[[str], None] = print,
) -> tuple[Path, Meta]:
    """Download one picked video into out_dir and return (file, author info).

    Raises with every failure reason joined, so the issue comment shows the exact errors.
    """
    errors: list[str] = []
    meta = Meta("unknown (see the Pexels page)", "", pick.page)
    dst = out_dir / "pexels-raw" / f"{pick.clip_id}.mp4"
    html = ""
    try:
        html = net.get(pick.page).decode("utf-8", "replace")
        meta = meta_from_page(html, pick.page)
    except Exception as e:  # noqa: BLE001 - reported below if nothing else works
        errors.append(f"page {pick.page}: {type(e).__name__}: {e}")
        meta = Meta(meta.author, "", pick.page, errors[-1])
    attempts: list[str] = []
    best = best_rendition(renditions_from_page(html, pick.pexels_id), pick.orientation)
    if best:
        attempts.append(best.url)
    attempts.append(f"https://www.pexels.com/download/video/{pick.pexels_id}/")
    for url in attempts:
        try:
            net.download(url, dst, {"Referer": pick.page})
            if dst.stat().st_size > 50_000:
                log(f"Pexels: {pick.clip_id} downloaded from {url}")
                if api_key and meta.author.startswith("unknown"):
                    try:        # the file works but the page doesn't name the author: ask the API
                        meta = api_rendition(net, pick.pexels_id, pick.orientation, api_key)[1]
                    except Exception as e:  # noqa: BLE001
                        meta = Meta(meta.author, "", pick.page,
                                    f"{meta.debug} | API: {type(e).__name__}: {e}")
                return dst, meta
            errors.append(f"{url}: file too small ({dst.stat().st_size} bytes)")
        except Exception as e:  # noqa: BLE001
            errors.append(f"{url}: {type(e).__name__}: {e}")
    if api_key:
        try:
            rendition, api_meta = api_rendition(net, pick.pexels_id, pick.orientation, api_key)
            net.download(rendition.url, dst)
            log(f"Pexels: {pick.clip_id} downloaded through the API")
            return dst, api_meta
        except Exception as e:  # noqa: BLE001
            errors.append(f"API: {type(e).__name__}: {e}")
    else:
        errors.append("API not tried: PEXELS_API_KEY is not set")
    raise RuntimeError(f"cannot download {pick.clip_id}: " + " | ".join(errors))
