# Hands check, before and after (issue #4)

Before = hands@0.1.0 (the first version), after = hands@0.2.0 with detector threshold **0.2** (chosen on the dev slice, see below). Same decoded frames, same rubric (both hands, manipulation, minimum 0.8). A check status of `fail` means the check would have rejected; since #76 the decision is `review` instead.

Every rate has a Wilson 95% interval and its count.

## HoloAssist hand visibility, validation windows (benchmark v2)

| model | clips | base reject rate | false reject rate | false accept rate | review rate |
|---|---|---|---|---|---|
| before (v0) | 124 | 0.91 [0.85-0.95] (113/124) | 1.00 [0.74-1.00] (11/11) | 0.01 [0.00-0.05] (1/113) | 0.05 [0.02-0.10] (6/124) |
| after (v1@0.2) | 124 | 0.91 [0.85-0.95] (113/124) | 0.91 [0.62-0.98] (10/11) | 0.05 [0.02-0.11] (6/113) | 0.01 [0.00-0.04] (1/124) |

## Synthetic hands slice (Egocentric-10K + hand defects)

| model | clips | base reject rate | false reject rate | false accept rate | review rate |
|---|---|---|---|---|---|
| before (v0) | 70 | 0.43 [0.32-0.55] (30/70) | 0.80 [0.65-0.90] (32/40) | 0.07 [0.02-0.21] (2/30) | 0.27 [0.18-0.39] (19/70) |
| after (v1@0.2) | 70 | 0.43 [0.32-0.55] (30/70) | 0.78 [0.62-0.88] (31/40) | 0.07 [0.02-0.21] (2/30) | 0.10 [0.05-0.19] (7/70) |

## Dev slice (HoloAssist train windows): how the threshold was chosen

| model | clips | base reject rate | false reject rate | false accept rate | review rate |
|---|---|---|---|---|---|
| before (v0) | 56 | 0.93 [0.83-0.97] (52/56) | 1.00 [0.51-1.00] (4/4) | 0.02 [0.00-0.10] (1/52) | 0.09 [0.04-0.19] (5/56) |
| v1, detector 0.5 | 56 | 0.93 [0.83-0.97] (52/56) | 0.50 [0.15-0.85] (2/4) | 0.06 [0.02-0.16] (3/52) | 0.09 [0.04-0.19] (5/56) |
| v1, detector 0.3 | 56 | 0.93 [0.83-0.97] (52/56) | 0.50 [0.15-0.85] (2/4) | 0.04 [0.01-0.13] (2/52) | 0.05 [0.02-0.15] (3/56) |
| v1, detector 0.2 | 56 | 0.93 [0.83-0.97] (52/56) | 0.25 [0.05-0.70] (1/4) | 0.06 [0.02-0.16] (3/52) | 0.04 [0.01-0.12] (2/56) |

Rule: lowest false reject rate + false accept rate; ties go to the higher threshold. Picked **0.2**.

## Clips without labels (measured values only)

| clip | before: both hands, manipulation | status | after: both hands | status |
|---|---|---|---|---|
| pexels_7204592 (Washing up in the sink, first-person) | 0.38 | fail | 0.83 | pass |
| pexels_7418650 (Making a salad, first-person) | 0.28 | fail | 0.35 | fail |
| pexels_37443407 (Whipping cream with an electric mixer, first-person) | 0.00 | fail | 0.00 | fail |
| pexels_7658012 (Putting ground coffee in a filter, first-person) | None | error | 0.25 | fail |
| pexels_7308220 (Folding laundry, third-person) | 0.24 | fail | 0.17 | fail |
| pexels_4520150 (Packing jeans in a box, third-person) | 0.70 | fail | 0.69 | fail |
| pexels_11102752 (Cooking in a pot, third-person) | 0.00 | fail | 0.56 | fail |
| pexels_5592524 (Cleaning a countertop, third-person) | 0.03 | fail | 0.04 | fail |
| pexels_4440711 (Loading a washing machine, third-person) | None | error | None | error |
| pexels_7641501 (Washing cups, third-person) | 0.05 | fail | 0.34 | fail |
| pexels_9141844 (Putting folded clothes in a bag, third-person) | 0.33 | fail | 0.44 | fail |

## Run notes

```json
{
 "dev": {
  "val_sessions_annotated": 1466,
  "split": "train",
  "skipped": {
   "hands ratio between 0.75 and 0.85 (ambiguous label)": 4
  },
  "overlays": 12
 },
 "val": {
  "val_sessions_annotated": 207,
  "split": "val",
  "skipped": {
   "hands ratio between 0.75 and 0.85 (ambiguous label)": 6
  },
  "overlays": 12
 },
 "minutes": 111.7
}
```
