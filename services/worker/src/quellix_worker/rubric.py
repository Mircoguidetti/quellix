"""Rubric evaluation: measurements + rubric -> decision.

Checks (models, detectors, general-model baselines) only produce *measurements*.
This module is the only place that turns measurements into pass / fail / uncertain
and into the final accept / reject / review. Keep it pure and fully tested.

Decision rule (see packages/contracts/CLAUDE.md):
1. any enabled critical check that fails -> reject
2. otherwise any non-critical fail, any uncertain/error, or a rule set to "review"
   that fired -> review
3. otherwise -> accept
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass, field
from typing import Any, Literal

from . import ENGINE_VERSION

CheckName = Literal[
    "task_completed", "hands_visible", "framing", "technical", "privacy", "originality"
]
CHECK_NAMES: tuple[CheckName, ...] = (
    "task_completed",
    "hands_visible",
    "framing",
    "technical",
    "privacy",
    "originality",
)
Status = Literal["pass", "fail", "uncertain", "skipped", "error"]
Effect = Literal["reject", "review"]


@dataclass(frozen=True)
class CheckOutput:
    """What a check produced. Exactly one of measurements / error / skipped is set.

    `skipped` is for checks deliberately not run because the decision is already a
    reject (e.g. an undecodable file, or a critical check already failed). A skipped
    check adds no reason. Use it only when another check has already rejected the
    video; otherwise use `error`, which sends the video to review.
    """

    measurements: Mapping[str, Any] | None = None
    error: str | None = None
    model: str | None = None
    skipped: str | None = None


@dataclass
class Reason:
    check: CheckName
    code: str
    message: str
    effect: Effect

    def to_dict(self) -> dict[str, Any]:
        return {
            "check": self.check,
            "code": self.code,
            "message": self.message,
            "effect": self.effect,
        }


@dataclass
class CheckResult:
    status: Status
    measurements: Mapping[str, Any] = field(default_factory=dict)
    model: str | None = None

    def to_dict(self) -> dict[str, Any]:
        out: dict[str, Any] = {"status": self.status, "measurements": dict(self.measurements)}
        if self.model:
            out["model"] = self.model
        return out


# The hands check cannot reject yet. The eval on issue #53 shows it failing 32 of 40 clips that
# were assumed good (false alarm rate 0.80); until benchmark v2 (issue #64) validates it, a
# `hands_visible.below_min` failure has effect `review` even when the rubric says `critical:
# true`. A false reject costs an honest contributor money; a doubtful case goes to review.
# One-line flip once #64 passes: set this to True.
HANDS_CAN_REJECT = False

# A ratio within this distance below min_ratio is "uncertain" (review), not "fail" (#4): the
# hands model's ratio runs below HoloAssist's tracking near the bar. Chosen on 287 HoloAssist
# train windows (dev false reject rate 1/13); validation false reject rate 2/11, false accept
# rate unchanged (eval/reports/hands-score.md).
HANDS_UNCERTAIN_BAND = 0.2

# Defaults mirror packages/contracts/rubric.schema.json.
DEFAULTS: dict[str, dict[str, Any]] = {
    "task_completed": {"enabled": True, "critical": True, "min_confidence": 0.7},
    "hands_visible": {
        "enabled": True,
        "critical": True,
        "scope": "manipulation",
        "require_both": True,
        "min_ratio": 0.8,
    },
    "framing": {
        "enabled": True,
        "critical": False,
        "max_off_target_ratio": 0.1,
        "max_unstable_ratio": 0.1,
    },
    "technical": {
        "enabled": True,
        "critical": True,
        "max_blur_ratio": 0.05,
        "max_bad_exposure_ratio": 0.1,
    },
    "privacy": {"enabled": True, "faces": "review", "documents": "review", "screens": "review"},
    "originality": {"enabled": True, "similarity_threshold": 0.9, "on_duplicate": "reject"},
}


def check_config(rubric: Mapping[str, Any], name: CheckName) -> dict[str, Any]:
    """The rubric's config for one check, with schema defaults filled in."""
    return {**DEFAULTS[name], **rubric.get("checks", {}).get(name, {})}


def _fmt_s(t: Any) -> str:
    total = int(round(float(t)))
    return f"{total // 60:02d}:{total % 60:02d}"


def _pct(x: float) -> str:
    return f"{round(x * 100)}%"


# Each evaluator returns (status, reasons) for a check given its config and measurements.
# Reasons carry the effect they would have; the final decision is derived from them.


def _task_completed(cfg: dict[str, Any], m: Mapping[str, Any]) -> tuple[Status, list[Reason]]:
    completed = m.get("completed")
    confidence = float(m.get("confidence", 0.0))
    effect: Effect = "reject" if cfg["critical"] else "review"
    if completed is None or confidence < cfg["min_confidence"]:
        return "uncertain", [
            Reason("task_completed", "task_completed.uncertain",
                   "Could not tell with enough confidence whether the task was completed.",
                   "review")
        ]
    if not completed:
        return "fail", [
            Reason("task_completed", "task_completed.not_completed",
                   "The task does not appear to be completed.", effect)
        ]
    return "pass", []


def _hands_visible(cfg: dict[str, Any], m: Mapping[str, Any]) -> tuple[Status, list[Reason]]:
    scope = "manipulation" if cfg["scope"] == "manipulation" else "whole"
    which = "both" if cfg["require_both"] else "any"
    key = f"ratio_{which}_{scope}"
    if key not in m:
        return "error", [
            Reason("hands_visible", "hands_visible.missing_measurement",
                   f"Hand visibility could not be measured ({key}).", "review")
        ]
    ratio = float(m[key])
    hands = "Both hands" if cfg["require_both"] else "Hands"
    where = "during manipulation" if scope == "manipulation" else "in the video"
    if round(cfg["min_ratio"] - HANDS_UNCERTAIN_BAND, 6) <= ratio < cfg["min_ratio"]:
        return "uncertain", [
            Reason("hands_visible", "hands_visible.near_min",
                   f"{hands} visible {_pct(ratio)} of the time {where}, just under the minimum "
                   f"({_pct(cfg['min_ratio'])}); a person should check.", "review")
        ]
    if ratio < cfg["min_ratio"]:
        effect: Effect = "reject" if cfg["critical"] and HANDS_CAN_REJECT else "review"
        return "fail", [
            Reason("hands_visible", "hands_visible.below_min",
                   f"{hands} visible {_pct(ratio)} of the time {where} "
                   f"(minimum {_pct(cfg['min_ratio'])}).", effect)
        ]
    return "pass", []


def _framing(cfg: dict[str, Any], m: Mapping[str, Any]) -> tuple[Status, list[Reason]]:
    reasons: list[Reason] = []
    effect: Effect = "reject" if cfg["critical"] else "review"
    off = float(m.get("off_target_ratio", 0.0))
    unstable = float(m.get("unstable_ratio", 0.0))
    if off > cfg["max_off_target_ratio"]:
        reasons.append(Reason("framing", "framing.off_target",
                              f"Camera pointed away from the work {_pct(off)} of the time "
                              f"(maximum {_pct(cfg['max_off_target_ratio'])}).", effect))
    if unstable > cfg["max_unstable_ratio"]:
        reasons.append(Reason("framing", "framing.unstable",
                              f"Unstable camera {_pct(unstable)} of the time "
                              f"(maximum {_pct(cfg['max_unstable_ratio'])}).", effect))
    return ("fail" if reasons else "pass"), reasons


def _technical(cfg: dict[str, Any], m: Mapping[str, Any]) -> tuple[Status, list[Reason]]:
    effect: Effect = "reject" if cfg["critical"] else "review"
    if m.get("decodable") is False:
        return "fail", [Reason("technical", "technical.not_decodable",
                               "The file could not be decoded.", "reject")]
    reasons: list[Reason] = []

    def add(code: str, msg: str) -> None:
        reasons.append(Reason("technical", code, msg, effect))

    duration = m.get("duration_s")
    if duration is not None:
        if "min_duration_s" in cfg and duration < cfg["min_duration_s"]:
            add("technical.too_short",
                f"Video is {duration:.0f}s long (minimum {cfg['min_duration_s']:.0f}s).")
        if "max_duration_s" in cfg and duration > cfg["max_duration_s"]:
            add("technical.too_long",
                f"Video is {duration:.0f}s long (maximum {cfg['max_duration_s']:.0f}s).")
    width, height = m.get("width"), m.get("height")
    if width is not None and height is not None and (
        width < cfg.get("min_width", 0) or height < cfg.get("min_height", 0)
    ):
        add("technical.low_resolution",
            f"Resolution {width}x{height} is below "
            f"{cfg.get('min_width', 0)}x{cfg.get('min_height', 0)}.")
    fps = m.get("fps")
    if fps is not None and fps < cfg.get("min_fps", 0):
        add("technical.low_fps", f"{fps:.0f} fps is below the minimum of {cfg['min_fps']:.0f}.")
    blur = m.get("blur_ratio")
    if blur is not None and blur > cfg["max_blur_ratio"]:
        add("technical.blurry",
            f"Blurry {_pct(blur)} of the time (maximum {_pct(cfg['max_blur_ratio'])}).")
    exposure = m.get("bad_exposure_ratio")
    if exposure is not None and exposure > cfg["max_bad_exposure_ratio"]:
        add("technical.bad_exposure",
            f"Too dark or too bright {_pct(exposure)} of the time "
            f"(maximum {_pct(cfg['max_bad_exposure_ratio'])}).")
    return ("fail" if reasons else "pass"), reasons


_PRIVACY_LABELS = {"faces": "face", "documents": "readable document", "screens": "readable screen"}


def _privacy(cfg: dict[str, Any], m: Mapping[str, Any]) -> tuple[Status, list[Reason]]:
    reasons: list[Reason] = []
    for kind, label in _PRIVACY_LABELS.items():
        action = cfg[kind]
        found = m.get(kind) or []
        if action == "ignore" or not found:
            continue
        first = found[0].get("t_s") if isinstance(found[0], Mapping) else None
        at = f" at {_fmt_s(first)}" if first is not None else ""
        more = f" (+{len(found) - 1} more)" if len(found) > 1 else ""
        reasons.append(Reason("privacy", f"privacy.{kind}", f"A {label} is visible{at}{more}.",
                              action))
    return ("fail" if reasons else "pass"), reasons


def _originality(cfg: dict[str, Any], m: Mapping[str, Any]) -> tuple[Status, list[Reason]]:
    similarity = float(m.get("max_similarity", 0.0))
    if similarity >= cfg["similarity_threshold"]:
        match = m.get("match_video_id")
        ref = f" (matches video {match})" if match else ""
        return "fail", [Reason("originality", "originality.duplicate",
                               f"This video was already delivered{ref}; "
                               f"similarity {similarity:.2f}.", cfg["on_duplicate"])]
    return "pass", []


_EVALUATORS = {
    "task_completed": _task_completed,
    "hands_visible": _hands_visible,
    "framing": _framing,
    "technical": _technical,
    "privacy": _privacy,
    "originality": _originality,
}


def evaluate(
    video_id: str,
    rubric: Mapping[str, Any],
    outputs: Mapping[str, CheckOutput],
) -> dict[str, Any]:
    """Apply the rubric to the check outputs and return a decision (decision.schema.json)."""
    checks: dict[str, Any] = {}
    reasons: list[Reason] = []

    for name in CHECK_NAMES:
        cfg = check_config(rubric, name)
        if not cfg.get("enabled", True):
            checks[name] = CheckResult("skipped").to_dict()
            continue
        out = outputs.get(name)
        if out is not None and out.skipped is not None:
            checks[name] = CheckResult("skipped", {"reason": out.skipped}, out.model).to_dict()
            continue
        if out is None or out.error is not None or out.measurements is None:
            detail = out.error if out is not None and out.error else "check did not run"
            checks[name] = CheckResult("error", {}, out.model if out else None).to_dict()
            reasons.append(Reason(name, f"{name}.error",
                                  f"The {name.replace('_', ' ')} check failed: {detail}.",
                                  "review"))
            continue
        status, check_reasons = _EVALUATORS[name](cfg, out.measurements)
        measurements: Mapping[str, Any] = out.measurements
        if (name == "hands_visible" and cfg["critical"] and not HANDS_CAN_REJECT
                and any(r.code == "hands_visible.below_min" for r in check_reasons)):
            # Record that the cap was applied: the rubric asked for a reject, we sent it to review.
            measurements = {**measurements, "reject_capped_to_review": True,
                            "reject_cap_note": "The hands check cannot reject until it is "
                            "validated (issues #53, #64); this failure was sent to review."}
        checks[name] = CheckResult(status, measurements, out.model).to_dict()
        reasons.extend(check_reasons)

    skipped_any = any(
        out.skipped is not None for out in outputs.values() if out is not None
    )
    if any(r.effect == "reject" for r in reasons):
        decision = "reject"
    elif skipped_any:
        # Safety net: a skip is only legitimate when something else rejected.
        decision = "review"
        reasons.append(Reason("technical", "pipeline.skipped_without_reject",
                              "Some checks were skipped without a rejection; "
                              "a person should look at this video.", "review"))
    elif reasons:
        decision = "review"
    else:
        decision = "accept"

    # Reject reasons first: they are the ones a contributor needs to read.
    reasons.sort(key=lambda r: 0 if r.effect == "reject" else 1)

    return {
        "video_id": video_id,
        "decision": decision,
        "reasons": [r.to_dict() for r in reasons],
        "checks": checks,
        "rubric": {"id": str(rubric["id"]), "version": int(rubric["version"])},
        "engine_version": ENGINE_VERSION,
    }
