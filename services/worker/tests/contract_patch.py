"""The contract change proposed for the viewpoint check (#79), applied in memory.

The coordinator applies it to packages/contracts; until then the worker leaves the check out of
its decisions (``pipeline.active_checks``) and these helpers let the tests validate against the
contract as it will be. Remove this file once the change is applied.
"""

from __future__ import annotations

import copy
import json
from typing import Any

from jsonschema import Draft202012Validator

from quellix_worker.contracts import CONTRACTS_DIR

VIEWPOINT_RUBRIC = {
    "type": "object",
    "additionalProperties": False,
    "properties": {
        "enabled": {"type": "boolean", "default": True},
        "required": {"enum": ["first_person", "third_person", "any"],
                     "default": "first_person"},
        "critical": {"type": "boolean", "default": True},
    },
}


def patched(name: str) -> dict[str, Any]:
    schema = json.loads((CONTRACTS_DIR / name).read_text())
    out = copy.deepcopy(schema)
    if name == "rubric.schema.json":
        out["properties"]["checks"]["properties"].setdefault("viewpoint", VIEWPOINT_RUBRIC)
    elif name == "decision.schema.json":
        enum = out["$defs"]["checkName"]["enum"]
        if "viewpoint" not in enum:
            enum.append("viewpoint")
    return out


def validate_rubric(rubric: dict[str, Any]) -> None:
    Draft202012Validator(patched("rubric.schema.json")).validate(rubric)


def validate_decision(decision: dict[str, Any]) -> None:
    Draft202012Validator(patched("decision.schema.json")).validate(decision)
