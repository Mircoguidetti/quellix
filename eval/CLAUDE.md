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

## Third-person test set (`test_sets/third_person_pexels.jsonl`)

All other tests are first-person. This set holds Pexels clips filmed from the side or front
(Pexels License, free commercial use) to measure that gap: links, author, viewpoint
(`third_person`) and what the worker returned on the day (`observed`, an observation, not a
label; `truth` stays null until a person labels the clip). The videos are never committed and
never shown on the site. It is written by `python -m quellix_eval.site_clips --third-person`
(the `Site clips` workflow does it); schema in `datasets/third_person.py`. The landing page's
one first-person clip is a separate flow (`--pexels`).

## Privacy face test set (`test_sets/privacy_faces.jsonl`, #83)

Real faces and face-free footage for the privacy check: Pixabay (Pixabay Content License, found
by query, kept by id), the founder's Pexels clips, HoloAssist task windows and Egocentric-10K
clips. Labels start from the source and are corrected by a person's eye on the contact sheets and
on the detection crops (`test_sets/privacy_faces_labels.json`: `face` / `no_face` / `drop`),
never from Ormes. A fixed hash of the clip id splits dev (60%, tune here) and held-out (40%).
`.github/workflows/privacy-fix.yml` runs `quellix_eval.privacy_faces collect` (sheets, crops,
per-detection features in `reports/privacy-faces/`) and `score` (the worker's own check before /
after, `reports/privacy-faces/score.md`); `quellix_eval.privacy_diagnosis` draws every raw face
detection on the Pexels clips. Pixabay API calls are throttled (100 per minute per key).

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
15 fps), adds 3 synthetic defects per clip (2 general ones round-robin + 1 hand defect),
runs the worker with a shared fingerprint store (`QUELLIX_FINGERPRINT_DB`) and writes
`report.md` to the job summary and as an artifact. Rubric `rubrics/eval_v0.json`: technical,
framing, privacy (faces / documents / screens = review, #47), originality, hands_visible
(manipulation, both hands, min 0.8); task off. Source clips are assumed acceptable (not
human-labelled, hands assumed visible); the report says so.

### Hands (#53)

Hand defects change the middle 60% of a clip (`HAND_INTERVAL`): `hand_out_one` (zoom on the
bottom-right quarter: the left hand leaves), `hands_out_both` (zoom on the top half: both
leave), `hand_truncated` (zoom on the top 70%: the bottom edge cuts the hands) are expected to
`fail`; `no_manipulation` (one frame held) is expected `uncertain` (a manifest label meaning
"must go to review"). Hand variants leave technical / privacy / originality `unknown`; other
variants leave hands `unknown`. The run needs the real hands model: `uv sync --extra hands`,
`python -m quellix_hands.weights download` and, on Linux, `libegl1 libgles2 libgl1`;
`quellix_eval.ci` refuses to start with the placeholder (`--allow-placeholder-hands` overrides).

### Phases, budgets and the Gemini spend cap

The driver runs the Gemini phase **first**, on a fixed subset (the first 20 originals and their
variants, 80 clips), with its own time budget (12 min, never more than the job has left after
the worker's minimum) and a spend cap (1 USD per run, checked before every clip, so the
overshoot is at most one clip). Then the worker runs the same subset first and the remaining
clips while time is left until the driver's 38-minute job budget. Clips an engine never reaches
are reported as "not run", not as failures, and the report shows spend and time used per phase.
The Gemini retry client also stops at the phase deadline, so one clip stuck in 429 backoff
cannot eat the worker's time.

## Benchmark v2 (#64): the customer-facing numbers

`.github/workflows/benchmark.yml` (Actions tab, a file under `eval/requests/benchmark/` pushed to
`main`, or the label `benchmark` on a PR) runs three slices in parallel and writes
`reports/benchmark-v2.md` (posted on #64):
- `tasks` and `hands`: HoloAssist validation sessions, read member by member from the official
  tars with HTTP Range requests (`benchmark/remote_tar.py`, indexes cached). Labels only from
  HoloAssist: action annotations (task: 60 s ending after vs. halfway through the last action)
  and hand tracking projected into the RGB frame (`benchmark/handpose.py`, as PyHoloAssist).
- `synthetic`: the existing defects on Egocentric-10K, reported separately, never pooled.
- Egocentric-10K blind slice: from `labels/egocentric10k-blind-v1.jsonl` when it exists (see
  `labels/README.md`; the kit is an artifact of every run).

Metrics (`benchmark/stats.py`): false reject AND false accept rate, precision, recall, review
rate, base reject rate, each with a Wilson 95% CI. Gemini: full rubric + measurement definitions
in the prompt, JSON-schema answer with per-check confidence (`prompts/benchmark_v2/`), cheap
model on every clip, strong model on a label-balanced order; spend cap per run (input `cap_usd`,
default 3) shared by the jobs (tasks 50%, hands 25%, synthetic 25%), checked before every call.

## Landing hero candidates (#84)

`python -m quellix_eval.hero` (workflow `Hero candidates`, started by `eval/hero-request.json`
on `agent/hero-candidates` or from the Actions tab) searches Pixabay (`PIXABAY_API_KEY`;
landscape, 10-60 s, largest rendition >= 1920 px) and the founder's two Pexels picks, keeps
clips with both hands fully visible >= 60%, no confident face (YuNet), blur <= 10% and a
viewpoint of first_person / uncertain (#79 check, merged in #80), writes 2x2 contact sheets to `reports/hero-candidates/`, one line per candidate
to `test_sets/hero_candidates.jsonl`, and runs the Pexels picks through the site-clips pipeline
(9 s window; landscape: the steadiest good window) with the worker's verdict on the delivered
cut. No video is committed; the encoded cuts are an artifact.
