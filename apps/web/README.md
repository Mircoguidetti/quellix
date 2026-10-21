# @quellix/web

Dashboard, public API (`/api/v1/*`), auth and public pages. Next.js 16 (App Router, Cache Components), Tailwind v4, shadcn-style components on Radix, `sonner`, `lucide-react`. Read `CLAUDE.md` and `AGENTS.md` before changing code.

## Run

```bash
pnpm --filter @quellix/web dev        # needs Supabase env vars (.env.example)
pnpm --filter @quellix/web dev:demo   # no Supabase: seeded demo data, demo@quellix.dev / quellix-demo
```

## Checks

```bash
pnpm lint && pnpm typecheck && pnpm test   # unit tests (Vitest)
pnpm build && pnpm e2e                     # Playwright: screenshots (1440 / 390 px), keyboard walkthrough, axe, console guard
pnpm lighthouse                            # with the demo server on :3100; fails under 95 on accessibility
```

`pnpm e2e` starts `next start` in demo mode, renders a synthetic first-person clip with Chromium + ffmpeg into `e2e/.cache/` (never committed) and writes screenshots to `e2e/screenshots/`.

## Layout

| Path | What |
|---|---|
| `src/app/page.tsx` | The landing, ported from `docs/design/landing-reference.html` |
| `src/app/(auth)` | Sign in, create account, forgot / reset password (server actions in `actions.ts`) |
| `src/app/app` | The dashboard: overview, review, videos, rubrics, contests, settings, upload |
| `src/app/contest/[videoId]` | Public contest page (shows only `effect: reject` reasons) |
| `src/components/ui` | Design-system components (Radix) |
| `src/lib/domain` | Data access, always scoped by `org_id` |
| `src/lib/rubric-eval.ts` | TS port of the worker's `rubric.py`, used by the rubric editor preview and the demo seed |
| `src/lib/demo` | Demo mode: in-memory Supabase stand-in and seed |

Design tokens live in `src/app/globals.css` (CSS variables + `@theme`), taken from the landing.
