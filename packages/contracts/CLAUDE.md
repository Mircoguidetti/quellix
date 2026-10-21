# packages/contracts

The single source of truth shared by web and worker. **Do not change these files unless the coordinator asked you to.** If your work needs a change, describe it in your final report.

- `rubric.schema.json` - the rubric format. Checks produce measurements; the rubric thresholds turn them into pass / fail / uncertain.
- `decision.schema.json` - the decision the worker writes and the API returns.
- `openapi.yaml` - the public API (`/v1`). Web implements it; customers integrate against it.
- `examples/` - valid example documents, used by tests on both sides.

Decision rule (implemented in `services/worker/src/quellix_worker/rubric.py`, mirrored nowhere else):
1. Any enabled critical check with status `fail` -> `reject`.
2. Otherwise, any `fail` on a non-critical check, any `uncertain` / `error` on an enabled check, or a privacy/originality rule set to `review` that fired -> `review`.
3. Otherwise -> `accept`.
Privacy and originality rules set to `reject` that fire count as critical fails.
