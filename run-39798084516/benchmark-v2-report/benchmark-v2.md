# Ormes benchmark v2

2026-10-22 · commit `634e33c` · run 39798084516 · **539 clips** (379 with independent labels) · Gemini spend **$0.00** of a $3.00 cap.

**How to read this.** Every rate has a 95% confidence interval (Wilson) and its count. A *false reject* is a good video rejected (it costs an honest contributor money); a *false accept* is a bad video accepted (it costs the collector a lab rejection). Both are always shown, next to the base reject rate. *Review* = sent to a person; it is neither a false reject nor a false accept, and its cost is the review rate.

## Independent labels (headline)

| engine | clips | base reject rate | false reject rate | false accept rate | reject precision | reject recall | review rate |
|---|---|---|---|---|---|---|---|
| Ormes | 379 | 0.64 | 0.08 [0.05-0.14] (11/136) | 0.00 [0.00-0.02] (1/243) | 0.91 [0.84-0.95] (106/117) | 0.44 [0.38-0.50] (106/243) | 0.69 [0.64-0.73] (261/379) |
| Gemini gemini-3.1-flash-lite | 0 | n/a | n/a | n/a | n/a | n/a | n/a |
| Gemini gemini-3.1-pro-preview | 0 | n/a | n/a | n/a | n/a | n/a | n/a |

## HoloAssist: task completion

Check `task_completed`:

| engine | clips | base reject rate | false reject rate | false accept rate | reject precision | reject recall | review rate |
|---|---|---|---|---|---|---|---|
| Ormes | 255 | 0.51 | 0.00 [0.00-0.03] (0/125) | 0.00 [0.00-0.03] (0/130) | n/a | 0.00 [0.00-0.03] (0/130) | 1.00 [0.99-1.00] (255/255) |


## HoloAssist: hand visibility

Check `hands_visible`:

| engine | clips | base reject rate | false reject rate | false accept rate | reject precision | reject recall | review rate |
|---|---|---|---|---|---|---|---|
| Ormes | 124 | 0.91 | 1.00 [0.74-1.00] (11/11) | 0.01 [0.00-0.05] (1/113) | 0.91 [0.84-0.95] (106/117) | 0.94 [0.88-0.97] (106/113) | 0.05 [0.02-0.10] (6/124) |

Not included: 6 hands ratio between 0.75 and 0.85 (ambiguous label).

## Synthetic defects (separate slice)

Check `technical`:

| engine | clips | base reject rate | false reject rate | false accept rate | reject precision | reject recall | review rate |
|---|---|---|---|---|---|---|---|
| Ormes | 120 | 0.20 | 0.00 [0.00-0.04] (0/96) | 0.38 [0.21-0.57] (9/24) | 1.00 [0.80-1.00] (15/15) | 0.62 [0.43-0.79] (15/24) | 0.00 [0.00-0.03] (0/120) |

Check `privacy`:

| engine | clips | base reject rate | false reject rate | false accept rate | reject precision | reject recall | review rate |
|---|---|---|---|---|---|---|---|
| Ormes | 120 | 0.17 | 0.02 [0.01-0.07] (2/99) | 0.33 [0.17-0.55] (7/21) | 0.88 [0.64-0.97] (14/16) | 0.67 [0.45-0.83] (14/21) | 0.00 [0.00-0.03] (0/120) |

Check `originality`:

| engine | clips | base reject rate | false reject rate | false accept rate | reject precision | reject recall | review rate |
|---|---|---|---|---|---|---|---|
| Ormes | 75 | 0.47 | 0.00 [0.00-0.09] (0/40) | 0.00 [0.00-0.10] (0/35) | 1.00 [0.90-1.00] (35/35) | 1.00 [0.90-1.00] (35/35) | 0.00 [0.00-0.05] (0/75) |

Check `hands_visible`:

| engine | clips | base reject rate | false reject rate | false accept rate | reject precision | reject recall | review rate |
|---|---|---|---|---|---|---|---|
| Ormes | 70 | 0.43 | 0.80 [0.65-0.90] (32/40) | 0.07 [0.02-0.21] (2/30) | 0.32 [0.20-0.46] (15/47) | 0.50 [0.33-0.67] (15/30) | 0.27 [0.18-0.39] (19/70) |


## Method, label provenance, limits

- **Task completion (HoloAssist, CDLA-Permissive-2.0, official validation split).** For each
  session, one 60 s clip ending just after the last annotated fine-grained action (completed)
  and one ending halfway through it (not completed). Labels come from HoloAssist's own action
  annotations; sessions with an uncorrected wrong action get no "completed" clip. Task text and
  steps are HoloAssist's coarse-action sentences.
- **Hand visibility (HoloAssist).** Labels come from the headset's own hand tracking: the 26
  joints of each hand are projected into the RGB frame with the released camera pose and
  intrinsics (as in the authors' PyHoloAssist). A hand is visible if every joint is inside
  the frame; "manipulation" = inside an annotated action. Windows of 20 s are drawn at random,
  not by label. Label pass if both hands are visible >= 85% of manipulation frames, fail if
  <= 75%; windows in between are left out as ambiguous.
- **Synthetic defects** are generated from Egocentric-10K clips assumed acceptable (not
  reviewed). They measure detection of known defects only and are never pooled with the
  independent slices.
- **Engines.** Ormes = the worker as deployed, scored with the slice's rubric (only the checks
  that have labels are on). Gemini gets the full rubric, the task and the measurement
  definitions, answers in a JSON schema with a per-check confidence (exact prompts:
  `eval/prompts/benchmark_v2/`); measurements below 0.5 confidence count as "could not tell".
  Both are turned into decisions by the same rubric code. The strong model runs on a
  label-balanced order until the spend cap stops it, and Ormes is shown on the same clips.
- **Limits.** HoloAssist is lab footage (assembly, appliances), not a collector's production
  traffic; base rates here are set by the construction of the slices, not by real traffic.
  Not-completed clips are cut inside the last action, a narrow kind of incompleteness. Hand
  pose has tracking noise (hence the 75-85% exclusion band). Gemini sees low-resolution frames
  to stay inside the budget.
- **Egocentric-10K blind labels: pending.** The labelling kit is ready (see `eval/CLAUDE.md`); that slice is added once an independent labeller has labelled it.
