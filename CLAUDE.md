# Quellix

Quellix decides which first-person (egocentric) videos a data collector should pay for. A collector uploads a video with its task and the lab's spec (the **rubric**); Quellix returns `accept`, `reject` or `review` with human-readable reasons. Reviewers only see `review` cases.

- **Customer:** data collectors for whom review is a cost (they pay contributors and bill labs per accepted hour). Not labs.
- **Promise:** fewer review hours and the lab's spec applied the same way to every video. We do NOT promise what the lab will accept.
- **What makes us hard to copy:** our own specialized models that beat general video models (Gemini, TwelveLabs Pegasus) on rejection precision, at lower cost. General models are a baseline to beat, a teacher for bootstrapping labels, and a fallback for unseen tasks. Never the product.

## Repository layout

| Path | Language | Owns |
|---|---|---|
| `apps/web` | TypeScript, Next.js | dashboard, public API (`/api/v1/*`), auth, rubric editor, upload + report, review list, data/DPA pages |
| `services/worker` | Python | video pipeline: decode, checks, rubric evaluation, decision. Deployed on Modal |
| `models/hands` | Python | hand visibility / truncation / hand-object contact models |
| `models/tasks` | Python | task-completion models (task library) |
| `eval` | Python | datasets, synthetic defects, metrics, baseline comparisons |
| `packages/contracts` | YAML / JSON Schema | the shared contracts: OpenAPI, rubric schema, decision schema |
| `supabase` | SQL | migrations, RLS policies, seed |

Each folder has its own `CLAUDE.md`. Read it before working there. **Stay inside the folder you were assigned**; if you need a change elsewhere, write it in your final report instead of making it.

## Contracts (change only with the coordinator's approval)

- `packages/contracts/openapi.yaml` - public API.
- `packages/contracts/rubric.schema.json` - rubric format, shared by web (editor) and worker (evaluation).
- `packages/contracts/decision.schema.json` - decision format returned by the worker and the API.
- `supabase/migrations/` - database schema. New migrations only; never edit an applied one.

## Product rules that code must respect

- Every decision carries: the decision, a list of reasons, every measurement, and the rubric id + version used.
- A false reject costs an honest contributor money. A doubtful case goes to `review`, never silently to `reject`.
- Customer videos are deleted after analysis. They are never used for training unless the customer has opted in (`organizations.training_opt_in`).
- Fingerprints are scoped to the customer that produced them. No cross-customer matching in v1.
- Main metric: **precision and recall on rejections**, compared against the customer's base rate. Generic "agreement" is not a metric we report.

## Commands

```bash
pnpm install                     # JS deps (root)
pnpm build | lint | typecheck    # via turbo, all JS packages
cd services/worker && uv sync && uv run pytest && uv run ruff check .
cd eval && uv sync && uv run pytest && uv run ruff check .
```

## Conventions

- TypeScript strict. Validate every external input with Zod.
- Python 3.12+, typed, `ruff` + `pytest`. No notebooks committed.
- No secrets in git. Env vars are documented in each folder's `.env.example`.
- Large files (videos, datasets, checkpoints) never go in git.
- Small, focused commits. Every change keeps CI green.
