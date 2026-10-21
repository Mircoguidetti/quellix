# Quellix

Automated acceptance for robot-training video. Quellix applies a lab's spec to every first-person video a data collector receives and decides `accept`, `reject` or `review`, with the reasons.

See `CLAUDE.md` for the architecture, the contracts and the rules every contributor follows.

## Quick start

```bash
pnpm install
pnpm --filter @quellix/web dev        # dashboard + API on http://localhost:3000

cd services/worker && uv sync && uv run pytest
cd eval && uv sync && uv run pytest
```
