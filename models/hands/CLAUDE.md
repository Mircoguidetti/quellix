# models/hands

Our first specialized model and the first piece of the moat. Goal: measure hand visibility on egocentric video better and cheaper than a general model.

## What it must output (per sampled frame, aggregated per video by the worker)

- left / right hand present
- each hand **fully visible** (wrist to fingertips) vs **cut by the frame edge** vs absent
- hand-object contact (is the hand manipulating something)
- from contact over time: manipulation segments `[[start_s, end_s], ...]`

Aggregated into the worker's `hands_visible` measurements: `ratio_both_manipulation`, `ratio_any_manipulation`, `ratio_both_whole`, `ratio_any_whole`, `manipulation_segments`.

## Approach

1. Start from an open, commercially licensed hand detector / pose model; check every license before use and record it here.
2. Measure it on `eval` data (Build AI Egocentric-10K subset + synthetic crops that push hands out of frame).
3. Fine-tune on egocentric frames for the truncation and contact labels.
4. Export to ONNX for the worker. Target: well under 1 cent of GPU per minute of video.

## Rules

- Checkpoints and data never go in git (see root `.gitignore`); document where they live.
- Every model version gets an eval report from `eval` before the worker uses it.
- Licenses of every pretrained weight and dataset listed in this file.

## Package `quellix_hands` (v0)

- `infer.py` per-frame states, `truncation.py` edge margin (default 0.02 of the frame side),
  `contact.py` pluggable contact + `manipulation_segments`, `aggregate.py` the worker measurements,
  `model.py` `HandsModel.measure(frames, timestamps)` / `model_id = "hands@<version>"`,
  `evaluate.py` per-frame truncation accuracy and ratio error on labelled clips.
- Detector: MediaPipe Hand Landmarker (`[mediapipe]` extra, needs `libegl1`). The core package only
  needs numpy.
- Weights: `python -m quellix_hands.weights download`, sha256-pinned, stored in
  `QUELLIX_HANDS_MODEL_PATH` or `~/.cache/quellix/hands/`. Never in git.
- Licenses: `LICENSES.md` (every weight and dataset, with verdicts). Plan for v1: `PLAN.md`.

```bash
uv sync && uv run ruff check . && uv run pytest
uv sync --extra mediapipe && uv run python -m quellix_hands.weights download   # real detector
```
