# Hands check, before and after (issue #4)

Before = hands@0.1.0 (the first version), after = hands@0.2.0 with detector threshold **0.2** (chosen on the dev slice, see below). Same decoded frames, same rubric (both hands, manipulation, minimum 0.8). A check status of `fail` means the check would have rejected; since #76 the decision is `review` instead.

Every rate has a Wilson 95% interval and its count.

## HoloAssist hand visibility, validation windows (benchmark v2)

| model | clips | base reject rate | false reject rate | false accept rate | review rate |
|---|---|---|---|---|---|
| before (v0) | 124 | 0.91 [0.85-0.95] (113/124) | 1.00 [0.74-1.00] (11/11) | 0.01 [0.00-0.05] (1/113) | 0.05 [0.02-0.10] (6/124) |
| after (v1@0.2) | 124 | 0.91 [0.85-0.95] (113/124) | 0.91 [0.62-0.98] (10/11) | 0.04 [0.02-0.10] (5/113) | 0.01 [0.00-0.04] (1/124) |

## Synthetic hands slice (Egocentric-10K + hand defects)

| model | clips | base reject rate | false reject rate | false accept rate | review rate |
|---|---|---|---|---|---|
| before (v0) | 0 | n/a | n/a | n/a | n/a |
| after (v1@0.2) | 0 | n/a | n/a | n/a | n/a |

### Validation windows labelled pass, one by one

Label ratio = share of manipulation frames with both hands fully visible in HoloAssist's own hand tracking; the others are the model's measurements.

| window | label ratio | before | status | after | status |
|---|---|---|---|---|---|
| holo_hands_z025-june-21-22-printer_big | 0.9845559845559846 | 0.1818 | fail | 0.6711 | fail |
| holo_hands_z068-june-29-22-rashult_assemble | 0.9915824915824916 | 0.2875 | fail | 0.6875 | fail |
| holo_hands_z060-june-28-22-switch | 0.8622881355932204 | 0.1831 | fail | 0.675 | fail |
| holo_hands_z168-sep-01-22-gladom_disassemble | 0.9137323943661971 | 0.4203 | fail | 0.7857 | fail |
| holo_hands_z153-aug-25-22-gopro | 0.8775510204081632 | 0.2375 | fail | 0.775 | fail |
| holo_hands_z071-june-29-22-knarrevik_assemble | 0.9916107382550335 | 0.4026 | fail | 0.7625 | fail |
| holo_hands_z041-june-24-22-marius_assemble | 0.875 | 0.0 | fail | 0.075 | fail |
| holo_hands_z062-june-29-22-rashult_assemble_broken | 0.9620034542314335 | 0.6125 | fail | 0.7625 | fail |
| holo_hands_z078-july-01-22-gladom_disassemble | 0.9318568994889267 | 0.45 | fail | 0.8375 | pass |
| holo_hands_z078-july-01-22-gopro | 0.960552268244576 | 0.2241 | fail | 0.3816 | fail |
| holo_hands_z168-sep-01-22-gladom_assemble | 0.9263698630136986 | 0.3443 | fail | 0.7606 | fail |

## Dev slice (HoloAssist train windows): how the threshold was chosen

| model | clips | base reject rate | false reject rate | false accept rate | review rate |
|---|---|---|---|---|---|
| before (v0) | 287 | 0.95 [0.92-0.97] (274/287) | 1.00 [0.77-1.00] (13/13) | 0.00 [0.00-0.02] (1/274) | 0.06 [0.04-0.09] (17/287) |
| v1, detector 0.2 | 287 | 0.95 [0.92-0.97] (274/287) | 0.38 [0.18-0.64] (5/13) | 0.01 [0.01-0.04] (4/274) | 0.02 [0.01-0.04] (6/287) |

Rule: lowest false reject rate + false accept rate; ties go to the higher threshold. Picked **0.2**.

## Proposed "uncertain" band (not in the worker yet: needs the rubric change on #4)

A `fail` whose ratio is within the band below the minimum (0.8) becomes `uncertain` (review). The band was chosen on the dev slice with this rule: the smallest band whose dev false reject rate is at most 0.1, else the one with the lowest; picked **0.2**.

Dev slice:

| model | clips | base reject rate | false reject rate | false accept rate | review rate |
|---|---|---|---|---|---|
| after, band 0.0 | 287 | 0.95 [0.92-0.97] (274/287) | 0.38 [0.18-0.64] (5/13) | 0.01 [0.01-0.04] (4/274) | 0.02 [0.01-0.04] (6/287) |
| after, band 0.1 | 287 | 0.95 [0.92-0.97] (274/287) | 0.23 [0.08-0.50] (3/13) | 0.01 [0.01-0.04] (4/274) | 0.05 [0.03-0.08] (13/287) |
| after, band 0.2 | 287 | 0.95 [0.92-0.97] (274/287) | 0.08 [0.01-0.33] (1/13) | 0.01 [0.01-0.04] (4/274) | 0.11 [0.08-0.15] (31/287) |
| after, band 0.3 | 287 | 0.95 [0.92-0.97] (274/287) | 0.00 [0.00-0.23] (0/13) | 0.01 [0.01-0.04] (4/274) | 0.17 [0.13-0.22] (49/287) |

Validation windows, scored once with the chosen band:

| model | clips | base reject rate | false reject rate | false accept rate | review rate |
|---|---|---|---|---|---|
| before (v0) | 124 | 0.91 [0.85-0.95] (113/124) | 1.00 [0.74-1.00] (11/11) | 0.01 [0.00-0.05] (1/113) | 0.05 [0.02-0.10] (6/124) |
| after (v1@0.2) | 124 | 0.91 [0.85-0.95] (113/124) | 0.91 [0.62-0.98] (10/11) | 0.04 [0.02-0.10] (5/113) | 0.01 [0.00-0.04] (1/124) |
| after + band 0.2 | 124 | 0.91 [0.85-0.95] (113/124) | 0.18 [0.05-0.48] (2/11) | 0.04 [0.02-0.10] (5/113) | 0.15 [0.09-0.22] (18/124) |

## Clips without labels (measured values only)

| clip | before: both hands, manipulation | status | after: both hands | status |
|---|---|---|---|---|
| pexels_7204592 (Washing up in the sink, first-person) | 0.38 | fail | 0.79 | fail |
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
   "hands ratio between 0.75 and 0.85 (ambiguous label)": 13
  },
  "overlays": 12
 },
 "band": 0.2,
 "val": {
  "val_sessions_annotated": 207,
  "split": "val",
  "skipped": {
   "hands ratio between 0.75 and 0.85 (ambiguous label)": 6
  },
  "overlays": 12
 },
 "minutes": 96.4
}
```
