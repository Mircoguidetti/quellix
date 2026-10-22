# eval

How we know Ormes is good. Everything another folder claims about accuracy must be reproducible from here.

## Metrics (`src/quellix_eval/metrics.py`)

Truth per video is `accept` / `reject` (lab outcome when available, otherwise a human reviewer). Ormes predicts `accept` / `reject` / `review`. We report:
- precision and recall on rejections, flag recall (reject or review), false reject rate, false accept rate, review rate;
- a cost-weighted total vs. "a person reviews everything";
- always next to the **base reject rate** and next to the **general-model baselines** (Gemini, TwelveLabs Pegasus) on the same videos.

Never report generic agreement.

## Data (nothing large in git; local cache under `eval/data/`, gitignored)

Only data we are allowed to use commercially:
- **Build AI Egocentric-10K** (Apache 2.0, Hugging Face `builddotai/Egocentric-10K`, gated: accept the terms with the project account). Factory work, head-mounted, 1080p30. Use a few-hundred-clip subset, never the full 16 TB.
- **HoloAssist** (CDLA-Permissive-2.0). Action annotations with start/end: cut before the end of an action to get a labelled "task not completed" example.
- Never use EPIC-KITCHENS, Ego4D or Ego-Exo4D (non-commercial licenses).
- Customer data only for orgs with `training_opt_in = true`.

## Synthetic defects

From a clean clip, generate labelled bad variants: hand pushed out of frame (crop/shift), task cut before its end, motion blur, under/over-exposure, overlaid document/face/screen, re-encoded/cropped/mirrored/speed-changed duplicates. Each variant records which check should fail and why, so labels are free.

## Deliverables

- `datasets/` - manifests (JSONL: clip id, source, license, path, labels), not the videos.
- `defects/` - the synthetic defect generator, with tests on tiny generated clips.
- `baselines/` - Gemini and TwelveLabs runners that produce measurements in the worker's measurement contract, with cost recorded.
- `run.py` - run any engine on a manifest and print the report; runs in CI on a small fixture set.

Python 3.12, `ruff` + `pytest`, `uv`.

## Running (see module docstrings)

```bash
uv sync --extra data --extra gemini --extra twelvelabs   # on the machine with access
python -m quellix_eval.datasets.egocentric10k --limit 300     # needs HF_TOKEN
python -m quellix_eval.datasets.holoassist --annotations A.json --video-dir V/
python -m quellix_eval.run --manifest eval/data/m.jsonl --engine worker --engine gemini
```

The `worker` engine calls `python -m quellix_worker check P --rubric R --video-id ID --report REPORT.json`
and expects a decision JSON on stdout (optional extra `cost_usd`). Baseline prices are
env-overridable (see `baselines/*.py`); check them against the providers' current price lists.

## First real evaluation on GitHub Actions

`.github/workflows/eval.yml` (manual run, or push to `main` of a file under `eval/requests/`,
optionally `{"clips": N}`) runs `python -m quellix_eval.ci`: streams the first clips of one
Egocentric-10K shard per factory (never whole shards), transcodes them small (20 s, 640 px,
15 fps), adds 3 synthetic defects per clip (`rubrics/eval_v0.json`: technical, framing,
privacy = reject, originality; hands and task off), runs the worker with a shared fingerprint
store (`QUELLIX_FINGERPRINT_DB`) and writes `report.md` to the job summary and as an artifact.
Source clips are assumed acceptable (not human-labelled); the report says so.

### Phases, budgets and the Gemini spend cap

The driver runs the Gemini phase **first**, on a fixed subset (the first 20 originals and their
variants, 80 clips), with its own time budget (12 min, never more than the job has left after
the worker's minimum) and a spend cap (1 USD per run, checked before every clip, so the
overshoot is at most one clip). Then the worker runs the same subset first and the remaining
clips while time is left until the driver's 38-minute job budget. Clips an engine never reaches
are reported as "not run", not as failures, and the report shows spend and time used per phase.
