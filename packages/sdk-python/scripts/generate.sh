#!/usr/bin/env bash
# Regenerates src/ormes/_generated from the OpenAPI contract.
set -euo pipefail
cd "$(dirname "$0")/.."
uv run datamodel-codegen \
  --input ../contracts/openapi.yaml --input-file-type openapi \
  --output src/ormes/_generated \
  --output-model-type pydantic_v2.BaseModel \
  --target-python-version 3.10 \
  --extra-fields allow --use-union-operator --use-standard-collections \
  --disable-timestamp \
  --formatters ruff-format \
  --base-class-map '{"decision.Schema": "ormes._decision_base.DecisionBase"}'
