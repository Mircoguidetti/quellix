# Third-party licenses (services/worker)

Checked on 2026-10-21 from the package metadata / upstream repositories. Everything below
is usable commercially. Re-check when upgrading.

| Component | Used for | License | Notes |
|---|---|---|---|
| PyAV (`av`) | decoding | BSD-3-Clause | wheels bundle FFmpeg (LGPL build) |
| NumPy | arrays | BSD-3-Clause | |
| opencv-python-headless | Laplacian, flow, YuNet runtime | Apache-2.0 | wheels bundle FFmpeg (LGPL) |
| pdqhash | PDQ perceptual hash (Meta ThreatExchange) | MIT | |
| httpx | Supabase / provider HTTP | BSD-3-Clause | |
| jsonschema | contract validation | MIT | |
| modal (optional extra) | deployment | Apache-2.0 | |
| YuNet `face_detection_yunet_2023mar.onnx` (opencv_zoo) | face detection | MIT | weights are in Git LFS; fetched on first use from github.com/opencv/opencv_zoo, or set `QUELLIX_YUNET_PATH` |
| SSCD (facebookresearch/sscd-copy-detection) | copy-detection embedding | **CC-BY-NC-4.0 (code and weights)** | **Not used yet** (`NoopEmbedder`). Not commercially usable as is: needs a decision before loading weights |
| Gemini API, TwelveLabs API | task baseline | provider terms | customer video is sent only when the organisation allows it |
