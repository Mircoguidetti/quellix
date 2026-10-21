"""Modal app: a GPU function that processes one job and a scheduled poller.

Imports cleanly without Modal credentials or the ``modal`` package installed (then
``app`` is None). Deploy (founder, later): ``modal deploy -m quellix_worker.modal_app``
with the secret ``quellix-worker`` holding SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and
optionally GEMINI_API_KEY / TWELVELABS_API_KEY / TWELVELABS_INDEX_ID /
QUELLIX_ALLOW_EXTERNAL_MODELS.
"""

from __future__ import annotations

import os

from .jobs import process_job
from .pipeline import Dependencies, PipelineConfig

GPU_USD_PER_SECOND = 0.000164  # T4; keep in sync with the GPU chosen below
GPU = "T4"


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


def handle_job(msg_id: int, job_id: str, video_id: str) -> str:
    from .checks.originality import SupabaseFingerprintStore
    from .store import Job, SupabaseStore

    store = SupabaseStore()
    config = PipelineConfig(allow_external_models=bool(_external_judge()),
                            gpu_usd_per_second=GPU_USD_PER_SECOND)
    deps = Dependencies(task_judge=_external_judge())
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
    image = (
        modal.Image.debian_slim(python_version="3.12")
        .apt_install("libgl1", "libglib2.0-0")
        .pip_install("av", "numpy", "opencv-python-headless", "pdqhash", "httpx", "jsonschema")
        .env({"QUELLIX_CONTRACTS_DIR": "/packages/contracts"})
        .add_local_python_source("quellix_worker")
        .add_local_dir("../../packages/contracts", "/packages/contracts", copy=True)
    )
    app = modal.App("quellix-worker", image=image,
                    secrets=[modal.Secret.from_name("quellix-worker")])

    @app.function(gpu=GPU, timeout=1800, retries=0)
    def process(msg_id: int, job_id: str, video_id: str) -> str:
        return handle_job(msg_id, job_id, video_id)

    @app.function(schedule=modal.Period(minutes=1), timeout=120)
    def poller() -> int:
        return poll_once(lambda *a: process.spawn(*a))
else:
    app = None
