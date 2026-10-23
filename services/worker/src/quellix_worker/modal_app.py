"""Modal app: a function that processes one job and a scheduled poller.

Imports cleanly without Modal credentials or the ``modal`` package installed (then ``app`` is
None). Deployed by ``.github/workflows/worker.yml`` (``modal deploy -m quellix_worker.modal_app``).

Compute: CPU by default (the v0 checks need no GPU). Set ``QUELLIX_WORKER_GPU`` (e.g. ``T4``)
at deploy time to run on a GPU and install torch/transformers for the DINOv2 embedder.
Containers scale to zero; ``max_containers`` caps spend.

Modal secret ``quellix-supabase`` (created by the founder, never in git) holds
``SUPABASE_URL`` and ``SUPABASE_SERVICE_ROLE_KEY``. It may also hold the optional keys of
``.env.example`` (GEMINI_API_KEY, QUELLIX_ALLOW_EXTERNAL_MODELS, QUELLIX_COMPUTE_USD_PER_SECOND,
QUELLIX_USE_DINOV2, ...).
"""

from __future__ import annotations

import os
from pathlib import Path

from .jobs import process_job
from .pipeline import Dependencies, PipelineConfig

SECRET_NAME = "quellix-supabase"
GPU = os.environ.get("QUELLIX_WORKER_GPU") or None  # read at deploy time
CPU_CORES = 2.0
MEMORY_MB = 4096
MAX_CONTAINERS = 5
# Pinned: opencv_zoo commit + sha256 of the weights (verified in the image build).
YUNET_COMMIT = "48b10fa505aeb51fbd127fc60a5c660040e823b7"
YUNET_SHA256 = "8f2383e4dd3cfbb4553ea8718107fc0423210dc964f9f4280604804ed2552fa4"
YUNET_URL = (f"https://media.githubusercontent.com/media/opencv/opencv_zoo/{YUNET_COMMIT}/"
             "models/face_detection_yunet/face_detection_yunet_2023mar.onnx")
YUNET_PATH = "/models/face_detection_yunet_2023mar.onnx"
TEXT_SHA256 = "03f550c6b406fda8bf54bd8327815f6c7e2edd98cea02348c93d879254366587"  # PP-OCRv3 DB
TEXT_URL = (f"https://media.githubusercontent.com/media/opencv/opencv_zoo/{YUNET_COMMIT}/"
            "models/text_detection_ppocr/text_detection_en_ppocrv3_2023may.onnx")
TEXT_PATH = "/models/text_detection_en_ppocrv3_2023may.onnx"
# MediaPipe Hand Landmarker (Apache-2.0) for models/hands; same URL / sha256 as
# quellix_hands.weights (a test keeps them equal). CPU only.
HANDS_URL = ("https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/"
             "float16/1/hand_landmarker.task")
HANDS_SHA256 = "fbc2a30080c3c557093b5ddfc334698132eb341044ccee322ccf8bcf3607cde1"
HANDS_PATH = "/models/hand_landmarker.task"
# MediaPipe selfie multiclass segmenter (Apache-2.0) for the viewpoint check; same URL / sha256
# as checks.viewpoint (a test keeps them equal).
SEGMENTER_URL = ("https://storage.googleapis.com/mediapipe-models/image_segmenter/"
                 "selfie_multiclass_256x256/float32/1/selfie_multiclass_256x256.tflite")
SEGMENTER_SHA256 = "c6748b1253a99067ef71f7e26ca71096cd449baefa8f101900ea23016507e0e0"
SEGMENTER_PATH = "/models/selfie_multiclass_256x256.tflite"


def compute_usd_per_second() -> float:
    """Price of one second of this function's compute (CPU cores + memory, or the GPU), from
    modal.com/pricing. Not hard-coded: unset -> 0, i.e. jobs.cost_usd counts API spend only."""
    return float(os.environ.get("QUELLIX_COMPUTE_USD_PER_SECOND")
                 or os.environ.get("QUELLIX_GPU_USD_PER_SECOND") or 0.0)


def _external_judge():
    if os.environ.get("QUELLIX_ALLOW_EXTERNAL_MODELS") != "1":
        return None
    if os.environ.get("GEMINI_API_KEY"):
        from .checks.task_baseline import GeminiJudge
        return GeminiJudge()
    if os.environ.get("TWELVELABS_API_KEY"):
        from .checks.task_baseline import TwelveLabsJudge
        return TwelveLabsJudge()
    return None


def _embedder():
    if os.environ.get("QUELLIX_USE_DINOV2") == "1":
        from .checks.originality import DinoV2Embedder
        return DinoV2Embedder()
    return None


def handle_job(msg_id: int, job_id: str, video_id: str) -> str:
    from .checks.originality import SupabaseFingerprintStore
    from .store import Job, SupabaseStore

    store = SupabaseStore()
    judge = _external_judge()
    config = PipelineConfig(allow_external_models=judge is not None,
                            compute_usd_per_second=compute_usd_per_second())
    deps = Dependencies(task_judge=judge, embedder=_embedder())
    return process_job(store, Job(msg_id, job_id, video_id), SupabaseFingerprintStore(),
                       config, deps)


def poll_once(spawn) -> int:
    """Read queued jobs and hand each to ``spawn(msg_id, job_id, video_id)``."""
    from .store import SupabaseStore

    store = SupabaseStore()
    n = 0
    while (job := store.read_job()) is not None:
        spawn(job.msg_id, job.job_id, job.video_id)
        n += 1
    return n


def sweep() -> dict[str, int]:
    """Daily: delete review videos whose 14 days have passed, and kept videos that already
    have a review decision."""
    from .store import SupabaseStore

    store = SupabaseStore()
    return {"expired": len(store.purge_expired()), "reviewed": len(store.purge_reviewed())}


try:
    import modal
except ImportError:  # modal is an optional extra; keep the module importable
    modal = None

def contracts_dir(module_file: str | Path = __file__) -> Path | None:
    """The repo's packages/contracts, found by walking up from this file; None when it is not
    there. Inside the Modal container this module lives at /root/quellix_worker/modal_app.py,
    which has no repo around it (and only two parents): never index a fixed parent."""
    for parent in Path(module_file).resolve().parents:
        candidate = parent / "packages" / "contracts"
        try:
            if candidate.is_dir():
                return candidate
        except OSError:  # e.g. PermissionError under /root on Python 3.12
            continue
    return None


if modal is not None:
    _pip = ["av", "numpy", "opencv-python-headless", "pdqhash", "httpx", "jsonschema",
            "mediapipe>=0.10.20"]  # models/hands detector (pulls opencv-contrib; both coexist)
    if GPU:
        _pip += ["torch", "transformers"]  # DINOv2 embedder
    image = (
        modal.Image.debian_slim(python_version="3.12")
        .apt_install("libgl1", "libglib2.0-0", "libegl1", "libgles2", "build-essential",
                     "curl")
        .pip_install(*_pip)
        .run_commands(
            f"mkdir -p /models && curl -fsSL -o {YUNET_PATH} {YUNET_URL}",
            f'echo "{YUNET_SHA256}  {YUNET_PATH}" | sha256sum -c -',
            f"curl -fsSL -o {TEXT_PATH} {TEXT_URL}",
            f'echo "{TEXT_SHA256}  {TEXT_PATH}" | sha256sum -c -',
            f"curl -fsSL -o {HANDS_PATH} {HANDS_URL}",
            f'echo "{HANDS_SHA256}  {HANDS_PATH}" | sha256sum -c -',
            f"curl -fsSL -o {SEGMENTER_PATH} {SEGMENTER_URL}",
            f'echo "{SEGMENTER_SHA256}  {SEGMENTER_PATH}" | sha256sum -c -',
        )
        .env({"QUELLIX_CONTRACTS_DIR": "/packages/contracts", "QUELLIX_YUNET_PATH": YUNET_PATH,
              "QUELLIX_TEXT_MODEL_PATH": TEXT_PATH, "QUELLIX_HANDS_MODEL_PATH": HANDS_PATH,
              "QUELLIX_SEGMENTER_PATH": SEGMENTER_PATH,
              **({"QUELLIX_USE_DINOV2": "1"} if GPU else {})})
    )
    # Local files are added only while building / deploying from the repo; inside the container
    # the image already holds them (QUELLIX_CONTRACTS_DIR=/packages/contracts).
    if modal.is_local():
        _contracts = contracts_dir()
        if _contracts is None:
            raise RuntimeError("packages/contracts not found next to services/worker")
        image = image.add_local_dir(str(_contracts), "/packages/contracts", copy=True)
        image = image.add_local_python_source("quellix_worker", "quellix_hands")
    app = modal.App("quellix-worker", image=image,
                    secrets=[modal.Secret.from_name(SECRET_NAME)])

    @app.function(gpu=GPU, cpu=None if GPU else CPU_CORES, memory=MEMORY_MB, timeout=1800,
                  retries=0, max_containers=MAX_CONTAINERS)
    def process(msg_id: int, job_id: str, video_id: str) -> str:
        return handle_job(msg_id, job_id, video_id)

    # Retries are handled by the queue (jobs.py), not by Modal.
    @app.function(schedule=modal.Period(minutes=1), timeout=120, max_containers=1)
    def poller() -> int:
        return poll_once(lambda *a: process.spawn(*a))

    @app.function(schedule=modal.Cron("17 3 * * *"), timeout=900, max_containers=1)
    def retention_sweep() -> dict[str, int]:
        return sweep()
else:
    app = None
