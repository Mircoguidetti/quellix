# models/tasks

The task library: models that decide whether a known task was completed (steps happened, final state reached), better than a general model.

## Status (v0, issue #32)

Code, tests and training pipeline are in place. A first head was trained on 88 HoloAssist train
sessions (`heads/head-v1.json`, candidate, not enabled) and **fails its own sanity check**:
out-of-fold AUC 0.45, class means 0.4947 vs 0.4967, every feature at chance (see
`eval/reports/task-head-v1.md`, "Checks before scoring"). It was not scored on validation clips.
The built-in head is hand-set and abstains on anything unclear. Do not enable either in the
worker until a trained head beats Gemini in `eval`. `quellix_tasks.checks` runs the checks that
must pass before a head is scored.

## How it works (`src/quellix_tasks/`)

```
frames @1 fps --SigLIP 2--> frame embeddings ┐
rubric steps + final state --SigLIP 2 text--> ┴-> similarity (T x K) -> align.py (in-order
step segments, missing steps allowed) -> features.py -> head.py (logistic, calibrated)
-> decide.py: completed true / false / null + steps with start_s / end_s
```

- `encoder.py`: SigLIP 2 base, `google/siglip2-base-patch16-224` (Apache-2.0). Optional
  `embed` extra; local weights via `$QUELLIX_SIGLIP_PATH`.
- `library.json` / `library.py`: 14 tasks (kitchen, laundry, household, factory) with ordered
  steps and a final state. A rubric's `task.library_id` pulls them in; rubric fields win.
- `align.py`: dynamic programme over per-step standardised similarity; each step gets at most
  one contiguous segment, in order; skipping a step is allowed (that is what "not completed"
  looks like).
- `head.py`: `p(completed)`; `accept_at` / `reject_at` thresholds. Between them the answer is
  `completed: null`, which the worker turns into `review`. Thresholds are fitted so at most
  `--max-false-accept` (default 2%) of not-completed clips are accepted.
- Output = the worker's `task_completed` measurements (`completed`, `confidence`, `start_s`,
  `end_s`, `steps` [{name, t_s, start_s, end_s, score, found}]) plus `p_completed`,
  `missing_steps` (contributor hints, #22) and `final_state_score`. Step times feed #31.

## Data and licenses

Training data comes from `eval` manifests (JSONL). `data.py` refuses EPIC-KITCHENS, Ego4D,
Ego-Exo4D and any license outside the allowlist.
- HoloAssist: CDLA-Permissive-2.0 (official release README: "CDLAv2"). Full sessions vs
  sessions cut inside the last action (`eval/.../datasets/holoassist.py`).
- Egocentric-10K: Apache-2.0, gated on Hugging Face (confirm the card when accepting).
- `teacher.py`: general-model labels (worker's Gemini / TwelveLabs judges), only for
  public-license clips, or customer clips whose org allows external models. Written as
  `labels_source: baseline`; people correct them before they count as truth.

## Commands

```bash
uv sync                                  # tests need no weights
uv run pytest && uv run ruff check .
uv sync --extra embed                    # on a machine with HF access (GPU optional)
uv run python -m quellix_tasks.train --manifest ../../eval/data/holoassist.jsonl \
    --out data/head.json --report data/train_report.json
QUELLIX_TASKS_HEAD=data/head.json uv run python -m quellix_tasks check clip.mp4 --rubric r.json
# official numbers, from eval/ (same clips, vs Gemini):
uv run python -m quellix_eval.run --manifest data/holoassist.jsonl --engine worker --engine gemini \
    --worker-cmd "$PWD/../models/tasks/.venv/bin/quellix-tasks"
```

`quellix-tasks check` (= `python -m quellix_tasks check`) has the worker CLI's contract but evaluates only
`task_completed` (all other checks disabled), so `eval` measures the task model alone.

## Next

- Train on HoloAssist + teacher-labelled Egocentric-10K; ship a task family only when it beats
  the best general model on rejection precision at equal recall in `eval`.
- Temporal model over frame features (replace the hand-made features) once there are a few
  thousand labelled clips.
