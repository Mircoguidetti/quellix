# Task head v1: first trained head, scored once on the benchmark tasks slice

**Status: **a check failed: the head was not scored on validation clips**.** A measurement of where the task model stands, not a verdict on the product.

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

