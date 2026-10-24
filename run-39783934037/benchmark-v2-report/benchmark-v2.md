# Ormes benchmark v2

2026-10-22 · commit `0ed53ff` · run 39783934037 · **539 clips** (379 with independent labels) · Gemini spend **$2.99** of a $3.00 cap (gemini-3.1-flash-lite: $0.42, gemini-3.1-pro-preview: $2.57).

**How to read this.** Every rate has a 95% confidence interval (Wilson) and its count. A *false reject* is a good video rejected (it costs an honest contributor money); a *false accept* is a bad video accepted (it costs the collector a lab rejection). Both are always shown, next to the base reject rate. *Review* = sent to a person; it is neither a false reject nor a false accept, and its cost is the review rate.

## Independent labels (headline)

| engine | clips | base reject rate | false reject rate | false accept rate | reject precision | reject recall | review rate |
|---|---|---|---|---|---|---|---|
| Ormes | 379 | 0.64 | 0.08 [0.05-0.14] (11/136) | 0.00 [0.00-0.02] (1/243) | 0.91 [0.84-0.95] (106/117) | 0.44 [0.38-0.50] (106/243) | 0.69 [0.64-0.73] (261/379) |
| Gemini gemini-3.1-flash-lite | 201 | 0.67 | 0.65 [0.53-0.76] (43/66) | 0.24 [0.18-0.32] (33/135) | 0.70 [0.62-0.77] (102/145) | 0.76 [0.68-0.82] (102/135) | 0.00 [0.00-0.02] (0/201) |
| Ormes, same 201 clips | 201 | 0.67 | 0.11 [0.05-0.20] (7/66) | 0.01 [0.00-0.04] (1/135) | 0.91 [0.83-0.96] (73/80) | 0.54 [0.46-0.62] (73/135) | 0.60 [0.53-0.66] (120/201) |
| Gemini gemini-3.1-pro-preview | 60 | 0.52 | 0.72 [0.54-0.85] (21/29) | 0.10 [0.03-0.25] (3/31) | 0.57 [0.43-0.70] (28/49) | 0.90 [0.75-0.97] (28/31) | 0.00 [0.00-0.06] (0/60) |
| Ormes, same 60 clips | 60 | 0.52 | 0.38 [0.23-0.56] (11/29) | 0.00 [0.00-0.11] (0/31) | 0.52 [0.33-0.71] (12/23) | 0.39 [0.24-0.56] (12/31) | 0.62 [0.49-0.73] (37/60) |

## HoloAssist: task completion

Check `task_completed`:

| engine | clips | base reject rate | false reject rate | false accept rate | reject precision | reject recall | review rate |
|---|---|---|---|---|---|---|---|
| Ormes | 255 | 0.51 | 0.00 [0.00-0.03] (0/125) | 0.00 [0.00-0.03] (0/130) | n/a | 0.00 [0.00-0.03] (0/130) | 1.00 [0.99-1.00] (255/255) |
| Gemini gemini-3.1-flash-lite | 119 | 0.50 | 0.69 [0.57-0.80] (41/59) | 0.33 [0.23-0.46] (20/60) | 0.49 [0.39-0.60] (40/81) | 0.67 [0.54-0.77] (40/60) | 0.00 [0.00-0.03] (0/119) |
| Ormes, same 119 clips | 119 | 0.50 | 0.00 [0.00-0.06] (0/59) | 0.00 [0.00-0.06] (0/60) | n/a | 0.00 [0.00-0.06] (0/60) | 1.00 [0.97-1.00] (119/119) |
| Gemini gemini-3.1-pro-preview | 36 | 0.50 | 0.94 [0.74-0.99] (17/18) | 0.06 [0.01-0.26] (1/18) | 0.50 [0.34-0.66] (17/34) | 0.94 [0.74-0.99] (17/18) | 0.00 [0.00-0.10] (0/36) |
| Ormes, same 36 clips | 36 | 0.50 | 0.00 [0.00-0.18] (0/18) | 0.00 [0.00-0.18] (0/18) | n/a | 0.00 [0.00-0.18] (0/18) | 1.00 [0.90-1.00] (36/36) |


## HoloAssist: hand visibility

Check `hands_visible`:

| engine | clips | base reject rate | false reject rate | false accept rate | reject precision | reject recall | review rate |
|---|---|---|---|---|---|---|---|
| Ormes | 124 | 0.91 | 1.00 [0.74-1.00] (11/11) | 0.01 [0.00-0.05] (1/113) | 0.91 [0.84-0.95] (106/117) | 0.94 [0.88-0.97] (106/113) | 0.05 [0.02-0.10] (6/124) |
| Gemini gemini-3.1-flash-lite | 82 | 0.91 | 0.29 [0.08-0.64] (2/7) | 0.17 [0.10-0.27] (13/75) | 0.97 [0.89-0.99] (62/64) | 0.83 [0.73-0.90] (62/75) | 0.00 [0.00-0.04] (0/82) |
| Ormes, same 82 clips | 82 | 0.91 | 1.00 [0.65-1.00] (7/7) | 0.01 [0.00-0.07] (1/75) | 0.91 [0.83-0.96] (73/80) | 0.97 [0.91-0.99] (73/75) | 0.01 [0.00-0.07] (1/82) |
| Gemini gemini-3.1-pro-preview | 24 | 0.54 | 0.36 [0.15-0.65] (4/11) | 0.15 [0.04-0.42] (2/13) | 0.73 [0.48-0.89] (11/15) | 0.85 [0.58-0.96] (11/13) | 0.00 [0.00-0.14] (0/24) |
| Ormes, same 24 clips | 24 | 0.54 | 1.00 [0.74-1.00] (11/11) | 0.00 [0.00-0.23] (0/13) | 0.52 [0.33-0.71] (12/23) | 0.92 [0.67-0.99] (12/13) | 0.04 [0.01-0.20] (1/24) |

Not included: 6 hands ratio between 0.75 and 0.85 (ambiguous label).

## Synthetic defects (separate slice)

Check `technical`:

| engine | clips | base reject rate | false reject rate | false accept rate | reject precision | reject recall | review rate |
|---|---|---|---|---|---|---|---|
| Ormes | 120 | 0.20 | 0.00 [0.00-0.04] (0/96) | 0.38 [0.21-0.57] (9/24) | 1.00 [0.80-1.00] (15/15) | 0.62 [0.43-0.79] (15/24) | 0.00 [0.00-0.03] (0/120) |
| Gemini gemini-3.1-flash-lite | 84 | 0.14 | 0.14 [0.08-0.24] (10/72) | 0.00 [0.00-0.24] (0/12) | 0.55 [0.35-0.73] (12/22) | 1.00 [0.76-1.00] (12/12) | 0.00 [0.00-0.04] (0/84) |
| Ormes, same 105 clips | 84 | 0.14 | 0.00 [0.00-0.05] (0/72) | 0.25 [0.09-0.53] (3/12) | 1.00 [0.70-1.00] (9/9) | 0.75 [0.47-0.91] (9/12) | 0.00 [0.00-0.04] (0/84) |
| Gemini gemini-3.1-pro-preview | 18 | 0.17 | 0.60 [0.36-0.80] (9/15) | 0.00 [0.00-0.56] (0/3) | 0.25 [0.09-0.53] (3/12) | 1.00 [0.44-1.00] (3/3) | 0.00 [0.00-0.18] (0/18) |
| Ormes, same 21 clips | 18 | 0.17 | 0.00 [0.00-0.20] (0/15) | 0.33 [0.06-0.79] (1/3) | 1.00 [0.34-1.00] (2/2) | 0.67 [0.21-0.94] (2/3) | 0.00 [0.00-0.18] (0/18) |

Check `privacy`:

| engine | clips | base reject rate | false reject rate | false accept rate | reject precision | reject recall | review rate |
|---|---|---|---|---|---|---|---|
| Ormes | 120 | 0.17 | 0.02 [0.01-0.07] (2/99) | 0.33 [0.17-0.55] (7/21) | 0.88 [0.64-0.97] (14/16) | 0.67 [0.45-0.83] (14/21) | 0.00 [0.00-0.03] (0/120) |
| Gemini gemini-3.1-flash-lite | 84 | 0.14 | 0.44 [0.34-0.56] (32/72) | 0.50 [0.25-0.75] (6/12) | 0.16 [0.07-0.30] (6/38) | 0.50 [0.25-0.75] (6/12) | 0.00 [0.00-0.04] (0/84) |
| Ormes, same 105 clips | 84 | 0.14 | 0.03 [0.01-0.10] (2/72) | 0.33 [0.14-0.61] (4/12) | 0.80 [0.49-0.94] (8/10) | 0.67 [0.39-0.86] (8/12) | 0.00 [0.00-0.04] (0/84) |
| Gemini gemini-3.1-pro-preview | 18 | 0.17 | 0.07 [0.01-0.30] (1/15) | 1.00 [0.44-1.00] (3/3) | 0.00 [0.00-0.79] (0/1) | 0.00 [0.00-0.56] (0/3) | 0.00 [0.00-0.18] (0/18) |
| Ormes, same 21 clips | 18 | 0.17 | 0.00 [0.00-0.20] (0/15) | 0.33 [0.06-0.79] (1/3) | 1.00 [0.34-1.00] (2/2) | 0.67 [0.21-0.94] (2/3) | 0.00 [0.00-0.18] (0/18) |

Check `originality`:

| engine | clips | base reject rate | false reject rate | false accept rate | reject precision | reject recall | review rate |
|---|---|---|---|---|---|---|---|
| Ormes | 75 | 0.47 | 0.00 [0.00-0.09] (0/40) | 0.00 [0.00-0.10] (0/35) | 1.00 [0.90-1.00] (35/35) | 1.00 [0.90-1.00] (35/35) | 0.00 [0.00-0.05] (0/75) |
| Gemini gemini-3.1-flash-lite | 60 | 0.33 | 0.00 [0.00-0.09] (0/40) | 1.00 [0.84-1.00] (20/20) | n/a | 0.00 [0.00-0.16] (0/20) | 0.00 [0.00-0.06] (0/60) |
| Ormes, same 105 clips | 60 | 0.33 | 0.00 [0.00-0.09] (0/40) | 0.00 [0.00-0.16] (0/20) | 1.00 [0.84-1.00] (20/20) | 1.00 [0.84-1.00] (20/20) | 0.00 [0.00-0.06] (0/60) |
| Gemini gemini-3.1-pro-preview | 12 | 0.17 | 0.00 [0.00-0.28] (0/10) | 1.00 [0.34-1.00] (2/2) | n/a | 0.00 [0.00-0.66] (0/2) | 0.00 [0.00-0.24] (0/12) |
| Ormes, same 21 clips | 12 | 0.17 | 0.00 [0.00-0.28] (0/10) | 0.00 [0.00-0.66] (0/2) | 1.00 [0.34-1.00] (2/2) | 1.00 [0.34-1.00] (2/2) | 0.00 [0.00-0.24] (0/12) |

Check `hands_visible`:

| engine | clips | base reject rate | false reject rate | false accept rate | reject precision | reject recall | review rate |
|---|---|---|---|---|---|---|---|
| Ormes | 70 | 0.43 | 0.80 [0.65-0.90] (32/40) | 0.07 [0.02-0.21] (2/30) | 0.32 [0.20-0.46] (15/47) | 0.50 [0.33-0.67] (15/30) | 0.27 [0.18-0.39] (19/70) |
| Gemini gemini-3.1-flash-lite | 56 | 0.29 | 0.62 [0.47-0.76] (25/40) | 0.06 [0.01-0.28] (1/16) | 0.38 [0.24-0.53] (15/40) | 0.94 [0.72-0.99] (15/16) | 0.00 [0.00-0.06] (0/56) |
| Ormes, same 105 clips | 56 | 0.29 | 0.80 [0.65-0.90] (32/40) | 0.12 [0.03-0.36] (2/16) | 0.16 [0.07-0.30] (6/38) | 0.38 [0.18-0.61] (6/16) | 0.25 [0.16-0.38] (14/56) |
| Gemini gemini-3.1-pro-preview | 13 | 0.23 | 0.90 [0.60-0.98] (9/10) | 0.00 [0.00-0.56] (0/3) | 0.25 [0.09-0.53] (3/12) | 1.00 [0.44-1.00] (3/3) | 0.00 [0.00-0.23] (0/13) |
| Ormes, same 21 clips | 13 | 0.23 | 0.60 [0.31-0.83] (6/10) | 0.00 [0.00-0.56] (0/3) | 0.14 [0.03-0.51] (1/7) | 0.33 [0.06-0.79] (1/3) | 0.38 [0.18-0.64] (5/13) |


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
