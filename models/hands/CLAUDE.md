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
