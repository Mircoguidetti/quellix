# apps/web

Next.js app (App Router, TypeScript strict, Tailwind). Deployed on Vercel with Root Directory `apps/web`. Read `AGENTS.md` first: this Next.js version differs from older ones; check `node_modules/next/dist/docs/` before using an API.

## Owns

- Dashboard: login (Supabase Auth: Google + email), organization, API keys, webhooks.
- Rubric editor: create/edit rubrics; every save is a new version. Validate against `@quellix/contracts/rubric.schema.json`.
- Upload page + report: upload videos (direct to Supabase Storage with signed URLs, never through Vercel), optional lab outcome per video, decisions with reasons.
- Review list: videos in `review` with reason, player, accept / reject buttons (writes `reviews`). No assignments, shifts or reviewer stats in v1.
- Contest: a contributor can contest a rejection; a person resolves it.
- Public API `/api/v1/*`, implementing `packages/contracts/openapi.yaml`. Auth by org API key (`Authorization: Bearer orm_live_...`, stored only as a SHA-256 hash).
- Public pages: data handling (deletion, no training without opt-in, sub-processors list), downloadable DPA.

## Rules

- Never import or call the worker directly: enqueue a job (Supabase Queues `video_jobs`) and read decisions from the database.
- The service-role key is server-only. Browser code uses the anon key + RLS.
- Validate every request body with Zod, matching the OpenAPI schemas.
- Do not edit `packages/contracts` or `supabase/migrations`; propose changes in your report.

## Commands

```bash
pnpm --filter @quellix/web dev
pnpm --filter @quellix/web lint
pnpm --filter @quellix/web typecheck
pnpm --filter @quellix/web build
```
