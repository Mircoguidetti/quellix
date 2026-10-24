# Task head v1: first trained head, scored once on the benchmark tasks slice

**Status: a check failed: the head was not scored on validation clips.** A measurement of where the task model stands, not a verdict on the product.

## Provenance

| item | value |
|---|---|
| check run | 40117367505 on commit `41169da12a463b2549fc94c5274e3441f238a3fc` |
| train run | 40101435890 on commit `3ab569a961972342bc7a5d1be77ecb1860b547dc` |
| head | `head-v1.json` version `trained-n175`, 88 train sessions |

## Checks before scoring

Run before any validation clip was built or scored; no threshold was changed. Overall: `passed = False`. The training run did not save its feature matrix, so it was rebuilt from the cached embeddings (keyed by clip id + window) and shown to be the matrix the head was fitted on (check 0).

### 0. The rebuilt matrix is the one the head was fitted on

| item | value |
|---|---|
| clips in manifest / dataset / training report | 175 / 175 / 175 |
| refit on the matrix vs committed head: max abs difference of weights, bias, mean, scale, thresholds | 8.08e-07 (tolerance 1e-06); ok = True |

### 1. Train/serve consistency

Not run: a check on the feature matrix failed first (below), and the stage stops there.

### 2. Label-shuffle control and 3. sanity of the real head

Out-of-fold (5 folds grouped by session, seed 0, same settings). Shuffle: labels permuted over the training set, grouping kept, 20 permutations; pass if the first permutation's AUC is within [0.41, 0.59] and the mean within [0.45, 0.55] (bands fixed before the run).

| measure | real labels | shuffled labels |
|---|---|---|
| out-of-fold AUC (completed vs not) | 0.4479 | mean 0.4732 (min 0.3294, max 0.5954); first 0.4905 |
| mean out-of-fold p_completed, completed clips | 0.4947 |  |
| mean out-of-fold p_completed, not-completed clips | 0.4967 |  |
| out-of-fold metrics at thresholds fitted on them (first permutation) |  | n=175; reject precision n/a; reject recall 0.00; false accept 0.01; false reject 0.00; review 0.99 |
| ok | False | True |

Confusion of the real out-of-fold probabilities at the head's thresholds (`{"reject_at": 0.3717545401709524, "accept_at": 0.6156729360650542}`; fitted on these same probabilities, so optimistic):

| truth | accept | reject | review |
|---|---|---|---|
| completed | 0 | 0 | 87 |
| not_completed | 0 | 2 | 86 |


## Diagnosis from the training features only (no validation clip used)

Read from `models/tasks/heads/train-features.json` (175 clips, 87 completed). Descriptive, not a tuning step: nothing below changes the head, its thresholds or its settings.

| feature | mean, completed | mean, not completed | single-feature AUC | paired difference (completed minus cut, same session), share of sessions > 0 |
|---|---|---|---|---|
| frac_steps_found | 0.387 | 0.400 | 0.483 | 0.39 |
| min_step_score | -1.000 | -0.951 | 0.489 | 0.00 |
| mean_step_score | -0.093 | -0.054 | 0.478 | 0.48 |
| last_step_found | 0.437 | 0.477 | 0.480 | 0.14 |
| last_step_open | 0.414 | 0.455 | 0.480 | 0.15 |
| final_state_rise | 0.136 | 0.139 | 0.514 | 0.52 |
| final_state_end | 0.129 | 0.129 | 0.524 | 0.55 |
| tail_after_last_s | 1.287 | 1.165 | 0.531 | 0.55 |

- None of the 8 features separates the classes: every single-feature AUC is between 0.48 and 0.53. The in-sample fit is also at chance (mean p 0.505 vs 0.489), so this is missing signal, not overfitting; the label-shuffle control behaves as it should (mean AUC 0.47), so it is not fold leakage either.
- The two clips of a session are nearly the same 60 s of video. The completed clip ends 2 s after the last annotated action, the cut clip halfway through it, so the windows differ by a few seconds at the end. The feature set (step alignment over a 1 fps embedding, 8 hand-made numbers) does not see that difference.
- Hypotheses, not tested here: (a) the rubric steps are the session's coarse-grained sentences (up to 20), but a 60 s window shows only the last part of the session, so about 60% of steps are "not found" in both classes (frac_steps_found 0.39 vs 0.40); (b) 1 fps sampling and a 224 px encoder cannot resolve whether the last action was finished; (c) 87 completed and 88 not-completed clips is small for a head on 8 features, but the in-sample result says more data alone would not create a signal from these features.

## Next levers (ranked)

1. **Features that look at the end of the clip**: embeddings of the last 5-10 s against the last step and the final state, and the change of the last-action step score across the final seconds. Needs: a feature change in `models/tasks` and a retrain on the same 175 clips, about an hour of CPU on a GitHub-hosted runner, $0.
2. **Steps matched to the clip**: give the model only the steps that fall inside the window (or the last 2-3 steps) instead of all coarse sentences. Needs: a window-aware task spec in `eval`, $0. This changes what the model is told, so it must be reported as a different run.
3. **Temporal model over frame embeddings** (the cached embeddings are reusable): a small model that reads the last N seconds. Needs a few thousand labelled clips to be trusted; HoloAssist has about 1466 train sessions, so about 2900 clips, building them costs about 10 s per session once the tar index is warm (observed: 914 s for 88 sessions).
4. **Teacher labels** (Gemini on unlabelled clips): costs money and is not needed to test levers 1-3 on HoloAssist; only worth it for task families HoloAssist does not cover.
