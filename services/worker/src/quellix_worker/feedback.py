"""Contributor feedback: a hint and the moments (segments) for every reason.

The rubric (``rubric.py``) decides and writes the reasons. This module only *annotates* the
finished decision for the person who filmed the video (issue #22, contract v2):

- ``hint``: one short, actionable sentence (the table below, plain English, <= 200 chars);
- ``segments``: ``[{start_s, end_s}]`` where the problem happens, from the checks' measurements;
- ``contributor_visible``: False for reasons the contributor must not see. Originality reasons
  are never visible (a contributor must not learn how duplicates are detected), nor are errors
  and pipeline notes. Hidden reasons carry no hint and no segments.

Adding a reason code to ``rubric.py`` without an entry here makes a test fail.
"""

from __future__ import annotations

import contextlib
import copy
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass
from typing import Any

from .checks.segments import MERGE_GAP_S, runs
from .rubric import check_config

SCHEMA_VERSION = 2
MAX_HINT_CHARS = 200

Segments = list[list[float]]


def _duration(seconds: float) -> str:
    s = float(seconds)
    if s >= 120 and round(s / 60) * 60 == round(s):
        return f"{round(s / 60)} minutes"
    return f"{round(s)} seconds" if s < 120 else f"{round(s / 60, 1):g} minutes"


@dataclass(frozen=True)
class Entry:
    hint: Callable[[Mapping[str, Any], Mapping[str, Any]], str] | None  # (check cfg, rubric)
    segments: Callable[[Mapping[str, Any], Mapping[str, Any]], Segments] | None = None  # (m, cfg)
    visible: bool = True


def _fixed(text: str) -> Callable[[Mapping[str, Any], Mapping[str, Any]], str]:
    return lambda cfg, rubric: text


def _from(key: str) -> Callable[[Mapping[str, Any], Mapping[str, Any]], Segments]:
    return lambda m, cfg: [list(s) for s in (m.get(key) or [])]


def _hands_hint(cfg: Mapping[str, Any], rubric: Mapping[str, Any]) -> str:
    if cfg.get("require_both", True):
        return ("Keep both hands in frame while you work: hold the camera a little lower and "
                "keep your hands in front of you.")
    return "Keep your hands in frame while you work: hold the camera a little lower."


def _hands_segments(m: Mapping[str, Any], cfg: Mapping[str, Any]) -> Segments:
    which = "both" if cfg.get("require_both", True) else "any"
    scope = "manipulation" if cfg.get("scope", "manipulation") == "manipulation" else "whole"
    segs = m.get(f"not_{which}_full_{scope}_segments")
    if segs is None and scope == "manipulation":  # a model without per-frame states
        segs = m.get("manipulation_segments")
    return [list(s) for s in (segs or [])]


def _task_hint(cfg: Mapping[str, Any], rubric: Mapping[str, Any]) -> str:
    final = (rubric.get("task") or {}).get("final_state") or "it is done"
    return f"Finish the whole task on camera and keep recording until {final}."


def _task_segments(m: Mapping[str, Any], cfg: Mapping[str, Any]) -> Segments:
    end = m.get("end_s")
    dur = m.get("duration_s")  # filled in by annotate() from the technical check
    return [[float(end), float(dur)]] if end is not None and dur is not None else []


def _privacy_segments(kind: str) -> Callable[[Mapping[str, Any], Mapping[str, Any]], Segments]:
    def seg(m: Mapping[str, Any], cfg: Mapping[str, Any]) -> Segments:
        times = [d["t_s"] for d in (m.get(kind) or []) if isinstance(d, Mapping) and "t_s" in d]
        return runs(times, 0.0)

    return seg


HINTS: dict[str, Entry] = {
    "hands_visible.below_min": Entry(_hands_hint, _hands_segments),
    "hands_visible.missing_measurement": Entry(None, visible=False),
    "framing.off_target": Entry(
        _fixed("Point the camera at your hands and the work, not around the room."),
        _from("off_target_segments")),
    "framing.unstable": Entry(
        _fixed("Keep your head steady, or mount the camera more firmly."),
        _from("unstable_segments")),
    "technical.too_short": Entry(lambda cfg, r: (
        "Record the whole task from start to finish; the video must be at least "
        f"{_duration(cfg['min_duration_s'])}.")),
    "technical.too_long": Entry(lambda cfg, r: (
        f"Keep the video under {_duration(cfg['max_duration_s'])}: start recording just before "
        "the task and stop right after.")),
    "technical.low_resolution": Entry(lambda cfg, r: (
        f"Record at {cfg.get('min_width', 0)}×{cfg.get('min_height', 0)} or higher "
        "(check your camera settings).")),
    "technical.low_fps": Entry(lambda cfg, r: (
        f"Set the camera to at least {round(cfg['min_fps'])} frames per second.")),
    "technical.blurry": Entry(
        _fixed("Clean the lens and move more slowly; avoid fast head turns."),
        _from("blur_segments")),
    "technical.bad_exposure": Entry(
        _fixed("Film in even light: avoid dark rooms and pointing the camera at windows or lamps."),
        _from("bad_exposure_segments")),
    "technical.not_decodable": Entry(
        _fixed("The file could not be read: export it again as MP4 and upload it again.")),
    "task_completed.not_completed": Entry(_task_hint, _task_segments),
    "task_completed.uncertain": Entry(
        _fixed("Make the end of the task clearly visible before you stop recording.")),
    "privacy.faces": Entry(
        _fixed("Point the camera away from people's faces."), _privacy_segments("faces")),
    "privacy.documents": Entry(
        _fixed("Keep papers and documents with text out of view."), _privacy_segments("documents")),
    "privacy.screens": Entry(
        _fixed("Keep phone and computer screens out of view."), _privacy_segments("screens")),
    "originality.duplicate": Entry(None, visible=False),
    "pipeline.skipped_without_reject": Entry(None, visible=False),
}
HIDDEN_PREFIXES = ("originality.", "pipeline.")
HIDDEN_SUFFIXES = (".error",)


def entry_for(code: str) -> Entry | None:
    if code.startswith(HIDDEN_PREFIXES) or code.endswith(HIDDEN_SUFFIXES):
        return Entry(None, visible=False)  # never visible, whatever the table says
    return HINTS.get(code)


def clean_segments(segments: Sequence[Sequence[float]], duration_s: float | None) -> Segments:
    """Clipped to [0, duration], empty ones dropped, merged when the gap is <= 1 s."""
    out: Segments = []
    for a, b in sorted((float(s[0]), float(s[1])) for s in segments):
        a = max(0.0, a)
        if duration_s is not None:
            if a > duration_s:
                continue  # entirely after the end of the video
            b = min(b, duration_s)
        if b < a:
            continue
        if out and a - out[-1][1] <= MERGE_GAP_S:
            out[-1][1] = max(out[-1][1], b)
        else:
            out.append([a, b])
    return [[round(a, 3), round(b, 3)] for a, b in out]


def annotate(decision: Mapping[str, Any], rubric: Mapping[str, Any],
             duration_s: float | None = None) -> dict[str, Any]:
    """A copy of ``decision`` with ``schema_version: 2`` and ``hint`` / ``segments`` /
    ``contributor_visible`` on every reason."""
    out = copy.deepcopy(dict(decision))
    checks = out.get("checks", {})
    if duration_s is None:
        duration_s = (checks.get("technical", {}).get("measurements") or {}).get("duration_s")
    out["schema_version"] = SCHEMA_VERSION
    for reason in out.get("reasons", []):
        entry = entry_for(reason["code"])
        if entry is None or not entry.visible:
            reason["contributor_visible"] = False  # unknown codes are hidden, never leaked
            continue
        cfg = check_config(rubric, reason["check"])
        m = dict(checks.get(reason["check"], {}).get("measurements") or {})
        m.setdefault("duration_s", duration_s)
        reason["contributor_visible"] = True
        if entry.hint is not None:
            with contextlib.suppress(KeyError):  # a threshold the rubric did not set: no hint
                reason["hint"] = entry.hint(cfg, rubric)[:MAX_HINT_CHARS]
        if entry.segments is not None:
            segs = clean_segments(entry.segments(m, cfg), duration_s)
            if segs:
                reason["segments"] = [{"start_s": a, "end_s": b} for a, b in segs]
    return out
