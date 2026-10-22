# Licenses: pretrained weights, code and datasets for `models/hands`

Rule: only commercially usable weights and data. A model is tainted if its **weights** were trained
on non-commercial data, even when its code is MIT or Apache. Anything MANO-derived is out
(MANO is research-only).

Audited on 2026-10-22 from this shell. **Verified** means we read the LICENSE file or the
license section of the README/model card at the URL given. **Reported** means it comes from the
paper or the project page and we could not open the primary source from this shell. Re-check
before shipping a new model version.

## Verdicts

| Name | Source | Code license | Weights license | Training data of the released weights | Weights downloadable from | Verdict |
|---|---|---|---|---|---|---|
| **MediaPipe Hand Landmarker** (palm detector + 21-keypoint landmark model, `hand_landmarker.task` float16) | github.com/google-ai-edge/mediapipe; model card: storage.googleapis.com/mediapipe-assets/Model Card Hand Tracking (Lite_Full) with Fairness Oct 2021.pdf | Apache-2.0 (verified, LICENSE) | Apache-2.0 (verified, model card: "LICENSED UNDER Apache License, Version 2.0") | Consented smartphone images from a Google AR app, plus synthetic data from GHUM (Apache-2.0, google-research) (verified, model card) | Weights: `storage.googleapis.com/mediapipe-models/...` (reachable here; the pinned sha256 is in `weights.py`). Runtime: PyPI `mediapipe` (1.1.1 has no bundled hand weights) | **Use for v0.** Caveat: the card lists "hand holding objects" and gloves as out of scope, which is exactly our manipulation case. That is why v0 is a baseline to measure, and the learned version (PLAN.md) fine-tunes on egocentric frames. |
| **100DOH / hand_object_detector** (Shan et al. 2020, contact states) | github.com/ddshan/hand_object_detector | MIT (verified) | No separate weights license. The `handobj_100K+ego` weights are trained on 100DOH plus frames from EPIC-KITCHENS, EGTEA and CharadesEgo, and the README says to "agree to the original conditions for using that data" (verified, README) | 100DOH: YouTube frames (terms on the project page, not verified here). Ego part: EPIC-KITCHENS (non-commercial) | Google Drive links (not reachable here) | **Do not use the weights.** `+ego` is tainted by EPIC-KITCHENS. `100K`-only has unclear YouTube-frame terms, so ask before any use. We only reuse its **contact taxonomy** (no contact / self / other person / portable object / stationary object) as our label scheme; a taxonomy is an idea, not licensed material. |
| **EgoHOS** (egocentric hand-object segmentation) | github.com/owenzlz/EgoHOS | MIT (verified) | Not stated separately | Frames from Ego4D, EPIC-KITCHENS and THU-READ (reported, paper; the README only links the download scripts) | Project download scripts (not GitHub releases) | **Do not use** (dataset and checkpoints derive from non-commercial datasets). |
| **WiLoR** (hand detection + 3D reconstruction) | github.com/rolpotamias/WiLoR | CC BY-NC-ND 4.0 (verified, `license.txt`) | CC BY-NC-ND 4.0 (verified, README "WiLoR models fall under the CC-BY-NC-ND License") | Needs MANO; detector built on Ultralytics (AGPL-3.0) (verified, README) | Hugging Face (blocked here) | **Do not use.** |
| **HaMeR** (3D hand mesh recovery) | github.com/geopavlakos/hamer | MIT (verified) | Not stated separately | Requires `MANO_RIGHT.pkl` (MANO license). Training data includes HInt, built on Ego4D and EPIC-KITCHENS VISOR frames, and FreiHAND (verified, README + github.com/ddshan/hint README) | Dropbox / project links | **Do not use** (MANO + non-commercial training data). |
| **MANO** and anything MANO-derived (MANO params, FrankMocap, HaMeR, WiLoR, ...) | mano.is.tue.mpg.de | MANO license: non-commercial research (reported, the MANO site requires a sign-up; WiLoR/HaMeR READMEs point to it) | n/a | n/a | Sign-up only | **Do not use.** FrankMocap is CC BY-NC 4.0 (verified, LICENSE). |
| **SAM 2 / SAM 2.1** (promptable image/video segmentation) | github.com/facebookresearch/sam2 | Apache-2.0 (verified) | Apache-2.0 (verified, README: "The SAM 2 model checkpoints ... are licensed under Apache 2.0") | SA-V dataset (CC BY 4.0, reported, Meta dataset page) | dl.fbaipublicfiles.com and Hugging Face (both **not reachable** from this shell) | **Usable** for offline label bootstrapping (hand masks on Egocentric-10K frames, PLAN.md). Not a runtime dependency. |
| **Ultralytics YOLOv8 / YOLO11** | github.com/ultralytics/ultralytics | AGPL-3.0 (verified) | AGPL-3.0 | COCO etc. | GitHub releases | **Do not use** without an Ultralytics enterprise license (AGPL would apply to the service). |
| **OpenPose** (hand keypoints) | github.com/CMU-Perceptual-Computing-Lab/openpose | CMU academic, non-commercial research only (verified) | Same | | | **Do not use.** |
| **MMPose / RTMPose / RTMDet-hand** (via `rtmlib`) | github.com/open-mmlab/mmpose, github.com/Tau-J/rtmlib | Apache-2.0 (verified, both) | Released hand checkpoints are "trained on 5 datasets" (rtmlib README), i.e. COCO-WholeBody-Hand, OneHand10K, FreiHAND, RHD, Halpe. COCO-WholeBody is research / non-commercial only (verified, COCO-WholeBody README); FreiHAND and RHD are research-only (reported) | see left | download.openmmlab.com (blocked here); HF mirror (blocked here) | **Weights: do not use.** **Code/architecture: usable** for training our own model on clean data (PLAN.md). |
| **YOLOX** | github.com/Megvii-BaseDetection/YOLOX | Apache-2.0 (verified) | Released COCO weights; COCO annotations CC BY 4.0, images under their Flickr licenses | COCO 2017 | GitHub releases (reachable) | **Usable** as a detector architecture and generic backbone init for the learned version. Record the COCO pretraining in the model card. |

## Datasets

| Dataset | License | Verdict |
|---|---|---|
| Build AI **Egocentric-10K** | Apache-2.0 (per `eval/CLAUDE.md`, gated on Hugging Face) | **Use** (main training/eval source for the learned version). |
| **HoloAssist** | CDLA-Permissive-2.0 (per `eval/CLAUDE.md`) | **Use.** |
| GHUM (synthetic hand/body model) | Apache-2.0 (google-research repo, verified) | Fine (already inside MediaPipe's training). |
| 100DOH | Project-page terms over YouTube frames (not verified here) | **Ask** before any use. Not needed for v0. |
| HaGRID / HaGRIDv2 | Custom "attribution and conditions reserved" license, explicitly "not a Creative Commons license" (verified, `license/en_us.pdf`) | **Ask**; third-person gestures, low value for us anyway. |
| COCO-WholeBody (hand keypoints) | Research and non-commercial only; commercial use requires contacting SenseTime (verified, README) | **Do not use.** |
| FreiHAND, RHD, OneHand10K | Research-only (reported) | **Do not use.** |
| EPIC-KITCHENS, Ego4D, Ego-Exo4D, EGTEA, CharadesEgo, THU-READ | Non-commercial | **Do not use** (also refused by `eval` manifests). |
| Customer videos | Only orgs with `organizations.training_opt_in = true` | Per root `CLAUDE.md`. |

## What v0 ships

- Runtime dependency: `mediapipe` (Apache-2.0, PyPI), as an **optional** extra (`quellix-hands[mediapipe]`). The core package depends only on `numpy`.
- Weights: `hand_landmarker.task` (float16, version 1), Apache-2.0, downloaded at deploy time by `python -m quellix_hands.weights download`, sha256-checked, never committed.
- Runtime system library: `libEGL.so.1` (Debian/Ubuntu `libegl1`) is needed by `mediapipe` 1.x even on CPU. The worker image must install it.
- `mediapipe` pulls `opencv-contrib-python` and `matplotlib`. Installing it next to the worker's `opencv-python-headless` gives two packages providing `cv2`; see the note in the PR.
