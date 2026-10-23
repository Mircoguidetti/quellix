"""Load and validate the shared contracts in packages/contracts."""

from __future__ import annotations

import json
import os
from functools import cache
from pathlib import Path
from typing import Any

from jsonschema import Draft202012Validator


def _find_contracts_dir() -> Path:
    """$QUELLIX_CONTRACTS_DIR (set in the Modal image), else packages/contracts found by walking
    up from this file. Never index a fixed parent: in the container there is no repo around
    this module and importing it must not fail before the first schema is needed."""
    explicit = os.environ.get("QUELLIX_CONTRACTS_DIR")
    if explicit:
        return Path(explicit)
    for parent in Path(__file__).resolve().parents:
        candidate = parent / "packages" / "contracts"
        try:
            if candidate.is_dir():
                return candidate
        except OSError:  # e.g. PermissionError under /root on Python 3.12
            continue
    return Path("packages/contracts")  # fails with a clear FileNotFoundError on first use


CONTRACTS_DIR = _find_contracts_dir()


@cache
def _validator(name: str) -> Draft202012Validator:
    schema = json.loads((CONTRACTS_DIR / name).read_text())
    return Draft202012Validator(schema)


def validate_rubric(rubric: dict[str, Any]) -> None:
    """Raise jsonschema.ValidationError if the rubric does not match rubric.schema.json."""
    _validator("rubric.schema.json").validate(rubric)


def validate_decision(decision: dict[str, Any]) -> None:
    """Raise jsonschema.ValidationError if the decision does not match decision.schema.json."""
    _validator("decision.schema.json").validate(decision)


def known_checks() -> frozenset[str]:
    """Check names the loaded decision contract accepts (a new check runs only once its contract
    change is applied, so the worker never emits a decision the contract rejects)."""
    schema = json.loads((CONTRACTS_DIR / "decision.schema.json").read_text())
    return frozenset(schema["$defs"]["checkName"]["enum"])


def load_example(name: str) -> dict[str, Any]:
    return json.loads((CONTRACTS_DIR / "examples" / name).read_text())
