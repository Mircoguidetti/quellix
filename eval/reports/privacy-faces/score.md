# Privacy faces: before / after (#83)

run 39936100105 on `agent/privacy-fix` (commit `a0905f6`) · the worker's own privacy check (`privacy:yunet-2023mar+scale-check+ppocrv3-regions`), faces only, on the labelled clips of `test_sets/privacy_faces.jsonl` (labels: source + eye check, `test_sets/privacy_faces_labels.json`). Before = the same detector without the second stage. After = a face must score at least 0.5 when its box is redrawn 40, 112 px wide, and one verified at 0.8 or more counts on a single frame. Clip level: false reject = a face reported on a clip without one; false accept = a real face never reported. Wilson 95% intervals.

| split | rule | false reject rate | false accept rate |
|---|---|---|---|
| dev | before | 0.01 [0.00-0.04] (1/123) | 0.11 [0.05-0.24] (5/44) |
| dev | after | 0.00 [0.00-0.03] (0/123) | 0.07 [0.02-0.18] (3/44) |
| heldout | before | 0.02 [0.00-0.08] (1/65) | 0.21 [0.11-0.38] (7/33) |
| heldout | after | 0.00 [0.00-0.06] (0/65) | 0.12 [0.05-0.27] (4/33) |

By group (both splits, before → after; errors / clips):

| group | label | clips | before: errors | after: errors |
|---|---|---|---|---|
| at work | face | 9 | 1 | 0 |
| at work | no_face | 19 | 0 | 0 |
| first-person | no_face | 6 | 1 | 0 |
| first-person work | face | 10 | 9 | 7 |
| first-person work | no_face | 50 | 0 | 0 |
| frontal | face | 34 | 1 | 0 |
| frontal | no_face | 8 | 0 | 0 |
| hands at work | no_face | 40 | 1 | 0 |
| round things | face | 2 | 0 | 0 |
| round things | no_face | 30 | 0 | 0 |
| small | face | 8 | 1 | 0 |
| small | no_face | 2 | 0 | 0 |
| third-person | no_face | 6 | 0 | 0 |
| turned | face | 14 | 0 | 0 |
| turned | no_face | 11 | 0 | 0 |
| worktop | no_face | 16 | 0 | 0 |

| clip | label | before | after |
|---|---|---|---|
| pexels_6693828, pestle (founder's clip) | no_face | face at 0.0 s | no face |
| pexels_5592524, countertop (real face, profile at the edge) | face | face at 16.0 s | face at 16.0 s |

Errors after the change (7):

- ego10k_factory012_worker001_00003 (heldout, first-person work): face missed
- ego10k_factory012_worker001_00009 (heldout, first-person work): face missed
- ego10k_factory013_worker001_00008 (heldout, first-person work): face missed
- ego10k_factory013_worker001_00006 (dev, first-person work): face missed
- ego10k_factory018_worker001_00002 (dev, first-person work): face missed
- ego10k_factory022_worker001_00001 (heldout, first-person work): face missed
- ego10k_factory022_worker001_00004 (dev, first-person work): face missed
