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
YUNET_URL = ("https://github.com/opencv/opencv_zoo/raw/main/models/face_detection_yunet/"
             "face_detection_yunet_2023mar.onnx")
YUNET_PATH = "/models/face_detection_yunet_2023mar.onnx"


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


try:
    import modal
except ImportError:  # modal is an optional extra; keep the module importable
    modal = None

if modal is not None:
    _contracts = Path(__file__).resolve().parents[4] / "packages" / "contracts"
    _pip = ["av", "numpy", "opencv-python-headless", "pdqhash", "httpx", "jsonschema"]
    if GPU:
        _pip += ["torch", "transformers"]  # DINOv2 embedder
    image = (
        modal.Image.debian_slim(python_version="3.12")
        .apt_install("libgl1", "libglib2.0-0", "build-essential", "curl")
        .pip_install(*_pip)
        .run_commands(f"mkdir -p /models && curl -fsSL -o {YUNET_PATH} {YUNET_URL}")
        .env({"QUELLIX_CONTRACTS_DIR": "/packages/contracts", "QUELLIX_YUNET_PATH": YUNET_PATH,
              **({"QUELLIX_USE_DINOV2": "1"} if GPU else {})})
        .add_local_dir(str(_contracts), "/packages/contracts", copy=True)
        .add_local_python_source("quellix_worker")
    )
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
else:
    app = None
