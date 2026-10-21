# eval

How we know Quellix is good. Everything another folder claims about accuracy must be reproducible from here.

## Metrics (`src/quellix_eval/metrics.py`)

Truth per video is `accept` / `reject` (lab outcome when available, otherwise a human reviewer). Quellix predicts `accept` / `reject` / `review`. We report:
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
