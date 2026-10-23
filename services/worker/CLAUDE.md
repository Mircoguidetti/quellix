# services/worker

The video pipeline. Input: a video file + a rubric. Output: a decision (`packages/contracts/decision.schema.json`). Deployed on Modal (GPU, billed per second).

## Architecture

```
video -> decode + sample frames -> checks (measurements only) -> rubric.evaluate() -> decision -> Supabase
```

- `src/quellix_worker/rubric.py` - **the only place** that turns measurements into pass / fail / uncertain and into accept / reject / review. Pure, no I/O, fully tested. Do not put thresholds anywhere else.
- `src/quellix_worker/checks/` - one module per check. A check returns `CheckOutput(measurements=..., model="name@version")` or `CheckOutput(error=...)`. Checks never decide.
- `src/quellix_worker/pipeline.py` - orchestration: run cheap checks first (technical, originality); if a critical one already fails, skip the expensive ones (task completion).
- `src/quellix_worker/feedback.py` - annotates the finished decision for the contributor (contract v2): `hint`, `segments`, `contributor_visible` on every reason, from one hint table. `originality.*`, `*.error` and `pipeline.*` are never visible. A new reason code in `rubric.py` needs a table entry (a test enforces it). Checks emit the intervals it needs as extra measurements (`*_segments`).
- `src/quellix_worker/contracts.py` - loads and validates the shared schemas.

## Measurement contract (what each check must return)

| Check | Measurements |
|---|---|
| `technical` | `decodable` bool, `duration_s`, `width`, `height`, `fps`, `blur_ratio` (share of sampled frames below the blur threshold), `bad_exposure_ratio` |
| `hands_visible` | `ratio_both_manipulation`, `ratio_any_manipulation`, `ratio_both_whole`, `ratio_any_whole` (share of frames where hands are fully visible, wrist to fingertips, not cut by the frame edge), optional `manipulation_segments` [[start_s, end_s], ...] |
| `framing` | `off_target_ratio`, `unstable_ratio` |
| `task_completed` | `completed` bool or null, `confidence` 0-1, optional `start_s`, `end_s`, `steps` [{name, t_s}] |
| `privacy` | `faces`, `documents`, `screens`: lists of `{t_s, box?, score?}` detections (faces also carry `verify`, the scale check of #83); weaker or unverified ones in `*_possible` |
| `originality` | `max_similarity` 0-1, `match_video_id` or null |
| `viewpoint` | `viewpoint` (`first_person` / `third_person` / `uncertain`), `confidence` 0-1, `first_person_ratio` (share of hand frames whose hands point up the frame) or null, evidence: `hand_frames`, `pointing_up_median`, `hand_scale_median`, `face_share`, `still_share`, `uncertain_why`. Runs only once `decision.schema.json` lists it (#79); reuses the hands model's landmarks and the privacy faces |

Ratios are 0-1. Timestamps are seconds from the start of the video.

## Rules

- A missing or failed check must lead to `review`, never to a silent `accept` (already enforced in `rubric.py`, keep it that way).
- Customer videos are deleted from storage after the decision is written. Never copy them anywhere else.
- Never send customer video to a third-party model (Gemini, TwelveLabs) unless the org config allows it; general models are used only for the baseline and as fallback. Record which model produced each measurement in `CheckOutput.model`.
- Record cost per job (`jobs.cost_usd`): GPU seconds and any API spend.
- Python 3.12, typed, `ruff` + `pytest`. Every check ships with tests on small fixture clips or synthetic frames (no large files in git).

## Commands

```bash
uv sync
uv run pytest
uv run ruff check .
```
