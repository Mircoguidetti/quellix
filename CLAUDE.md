# Ormes

> Product name: **Ormes** (renamed from Quellix on 2026-10-22; the repository, Python packages and env vars keep the `quellix` name until a planned internal rename). All user-facing text says Ormes.

Ormes decides which first-person (egocentric) videos a data collector should pay for. A collector uploads a video with its task and the lab's spec (the **rubric**); Ormes returns `accept`, `reject` or `review` with human-readable reasons. Reviewers only see `review` cases.

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
- **Data rule (founder-approved, 2026-10-21): we keep what surrounds the video, not the video.**
  - Customer videos are deleted after analysis. Exception: a video whose decision is `review` is kept until a person decides it, at most 14 days, then deleted anyway. A video that fails processing is deleted after the last attempt.
  - Videos are never used for training, resold or shown to another customer, unless the customer has opted in (`organizations.training_opt_in`, which earns a discount). Opted-in videos train Ormes's own models only.
  - We always keep, per customer: decisions, reasons, every measurement, rubric versions, reviewer overrides (with their note), lab outcomes, and fingerprints. These are our labels and our moat; they are never shared across customers in v1.
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

- **Everything is in English:** code, comments, identifiers, UI copy, error messages, docs, commit messages, issue comments and pull requests. This applies even when the person or prompt talking to you writes in another language.
- TypeScript strict. Validate every external input with Zod.
- Python 3.12+, typed, `ruff` + `pytest`. No notebooks committed.
- No secrets in git. Env vars are documented in each folder's `.env.example`.
- Large files (videos, datasets, checkpoints) never go in git.
- Small, focused commits. Every change keeps CI green.
