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

Contributor feedback (decision schema v2, issue #22). Each reason may carry `hint` (one actionable sentence for the person filming), `segments` (`[{start_s, end_s}]`) and `contributor_visible`. Consumers show a contributor only visible reasons:
- absent `contributor_visible` means visible, except `originality.*` (never visible, even if the flag says true), `*.error` and `pipeline.*`;
- order by the first segment start; whole-video reasons last;
- hidden reasons that reject become one generic message, hidden review-only reasons are dropped.
Implemented in `ormes.feedback` (Python SDK), `contributorFeedback` (TS SDK) and `apps/web/src/lib/feedback.ts`, all tested against `examples/decision.feedback.json` + `decision.feedback.expected.json`.
