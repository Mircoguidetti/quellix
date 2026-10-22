# Plan: from v0 (MediaPipe + heuristic) to a learned hands model

## Why a learned version

v0 is a commercially clean baseline. It has two known gaps:

1. MediaPipe's model card lists **hands holding objects** as out of scope. That is our main case.
2. Contact and manipulation come from a hand-written heuristic (`contact.py`): flexion, position
   and motion. It is not validated and cannot tell the 100DOH contact types apart.

Collectors' specs say things like "both hands visible, wrist to fingertips, for at least 80% of
the manipulation". That needs per-hand truncation and the manipulation interval to be right. The
benchmark target is to **beat Gemini 3 Flash on rejection precision for contact-rich clips**
(FailBench reports general models below 0.60 balanced accuracy there, biased toward "success").

## Step 0: measure v0 first

Before training anything, run v0 through `eval` and keep the report as the baseline:
- a gold set (below), plus synthetic crops of clean Egocentric-10K clips;
- `python -m quellix_hands.evaluate` for per-frame truncation precision/recall and ratio MAE;
- the worker engine in `eval/run.py` with `hands_visible` turned on, for **rejection precision
  and recall on `hands_visible`** next to the base reject rate and the Gemini / TwelveLabs
  baselines on the same clips.

## Data (commercial-use only, see LICENSES.md)

| Source | Use | Volume |
|---|---|---|
| Build AI Egocentric-10K (Apache-2.0) | main train/val/test, factory manipulation, head-mounted | ~300 clips for the gold set, ~3-5k clips sampled at 2-4 fps for training (never whole shards) |
| HoloAssist (CDLA-Permissive-2.0) | second domain (assembly, AR headset), action intervals give manipulation labels | ~200 clips |
| Synthetic crops / shifts of clean frames | truncation labels for free: crop geometry plus teacher keypoints decide exactly which hand is cut | unlimited |
| Customer video | only orgs with `training_opt_in = true` | later |

Never: EPIC-KITCHENS, Ego4D, Ego-Exo4D, EGTEA, CharadesEgo, 100DOH-ego weights, COCO-WholeBody,
FreiHAND, anything MANO.

## Labels

Per sampled frame, per hand (left/right, wearer's view):
- `state`: full / truncated / absent;
- `box` and, where visible, 21 keypoints;
- `contact`: none / self / other person / portable object / stationary object (100DOH taxonomy,
  used as a label scheme only);

and per clip, manipulation intervals `[[start_s, end_s], ...]`.

How we get them:
1. **Teacher pass** (automatic): MediaPipe v0 keypoints on clean frames. Then **SAM 2.1**
   (Apache-2.0, offline only) prompted with those keypoints gives hand masks, so boxes stay tight
   when fingers are hidden behind objects.
2. **Synthetic truncation** (automatic): shift or crop frames where the teacher says both hands
   are full. The geometry gives exact `truncated` labels and a margin sweep.
3. **Gold set** (human): about 3,000 frames from about 300 clips, labelled for state and contact
   by two annotators, with agreement measured. Manipulation intervals are labelled per clip. This
   set is never trained on.
4. General models as teachers: only after a legal check. The Gemini API terms restrict using
   outputs to build competing models. Until that is cleared, Gemini and TwelveLabs are baselines
   only, never label sources.

## Model

- **Detector and keypoints:** a single-stage detector (YOLOX-s, Apache-2.0, or the RTMDet / RTMPose
  architecture, Apache-2.0, trained from scratch on our data only, since the released hand weights
  are tainted). Heads: hand box, side, 21 keypoints with per-keypoint "outside frame" flags, so
  truncation is predicted directly, not only inferred from extrapolated keypoints.
- **Contact head:** a 5-way classifier on ROI features of each hand plus a crop of the region in
  front of it.
- **Temporal head:** a small 1D conv or GRU over per-frame features (about 4 fps) that outputs
  manipulation probability. Segments are taken with the same hysteresis / gap / min-length rules
  as v0, so the aggregation stays identical.
- Plugs into the existing API: a `Detector` and a `ContactEstimator` implementation, so
  `aggregate.py` and the worker contract do not change.

## Export and serving

- PyTorch, then ONNX (opset 17), run with `onnxruntime` (CPU) or `onnxruntime-gpu`; fp16 on GPU.
- This also removes the `mediapipe` runtime constraints (libEGL, `opencv-contrib-python`).
- Cost target: **well under 1 cent of compute per minute of video**. v0 measured here: MediaPipe on
  CPU takes about 17 ms per 480x270 frame (4 cores, no hands in frame; add a few ms per detected
  hand). At the worker's 4 fps that is about 240 frames, or about 4-6 CPU-seconds, per minute of
  video, i.e. a small fraction of a cent at any cloud CPU price. The learned model at 640 px is
  estimated at 3-5 ms per frame on an L4 or T4, about 1 GPU-second per minute. Both figures are
  estimates; `jobs.cost_usd` in the worker is the real number.

## Comparison in `eval` (what "better" means)

Reported per model version, never as generic agreement:
- per-frame truncation precision / recall, state confusion, ratio MAE (`quellix_hands.evaluate`);
- manipulation segment IoU against labelled intervals;
- **rejection precision and recall on `hands_visible`** at the rubric's threshold (40-90% of
  frames depending on the spec), with the base reject rate, on contact-rich clips;
- the same clips through Gemini 3 Flash and TwelveLabs Pegasus (`eval/baselines`), with cost per
  minute.

Ship criteria for v1: rejection precision above Gemini 3 Flash on the contact-rich subset, a
false reject rate not higher than v0, and the eval report attached to the PR that switches the
worker to it.

## Milestones

1. v0 eval report (this package + `eval`): baseline numbers, including where the heuristic fails.
2. Gold set labelled; label spec and annotator agreement published.
3. Synthetic truncation set and teacher / SAM 2 pipeline (offline, GPU job on Modal).
4. v1 training (detector + keypoints + contact), then temporal head.
5. ONNX export, cost measured in the worker, eval report, worker switch behind a flag.
