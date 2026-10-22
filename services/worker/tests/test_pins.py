import pytest

from quellix_worker import modal_app
from quellix_worker.checks import privacy


def test_yunet_is_pinned_to_a_commit_and_hash():
    for url in (privacy.YUNET_URL, modal_app.YUNET_URL):
        assert "/main/" not in url and privacy.YUNET_COMMIT in url
    assert privacy.YUNET_COMMIT == modal_app.YUNET_COMMIT and len(privacy.YUNET_COMMIT) == 40
    assert privacy.YUNET_SHA256 == modal_app.YUNET_SHA256 and len(privacy.YUNET_SHA256) == 64


def test_text_model_is_pinned_too():
    assert "/main/" not in privacy.TEXT_URL and privacy.ZOO_COMMIT in privacy.TEXT_URL
    assert privacy.TEXT_SHA256 == modal_app.TEXT_SHA256 and len(privacy.TEXT_SHA256) == 64
    assert privacy.TEXT_URL == modal_app.TEXT_URL


def test_import_does_not_index_a_fixed_parent_of_the_module_path():
    """In the Modal container the module is /root/quellix_worker/modal_app.py: two parents."""
    import re
    from pathlib import Path

    assert modal_app.contracts_dir("/root/quellix_worker/modal_app.py") is None  # no IndexError
    src = Path(modal_app.__file__).read_text()
    assert not re.search(r"parents\[\d+\]", src)


def test_contracts_dir_is_found_from_the_repo_checkout():
    found = modal_app.contracts_dir()
    assert found is not None and (found / "decision.schema.json").is_file()


def test_modal_app_imports_inside_a_container_layout():
    """Regression for #41: in the container the module is /tmp/x/quellix_worker/modal_app.py
    (too few parents for parents[4]) and there is no repo around it. Simulate a running Modal
    Function and import it from there."""
    import shutil
    import subprocess
    import sys
    import tempfile
    from pathlib import Path

    pytest.importorskip("modal")
    root = Path(tempfile.mkdtemp(dir="/tmp", prefix="qx"))
    try:
        shutil.copytree(Path(modal_app.__file__).parent, root / "quellix_worker",
                        ignore=shutil.ignore_patterns("__pycache__"))
        code = (
            "import inspect, modal\n"
            "cls = inspect.getmodule(modal.is_local).__dict__['_TaskLifecycleManager']\n"
            "cls._singleton = object()\n"
            "assert not modal.is_local()\n"
            "import quellix_worker.modal_app as m\n"
            "assert m.app is not None and 'process' in m.app.registered_functions\n"
            "assert 'poller' in m.app.registered_functions\n"
        )
        import os

        env = {k: v for k, v in os.environ.items() if k != "QUELLIX_CONTRACTS_DIR"}
        proc = subprocess.run([sys.executable, "-c", code], cwd="/tmp", capture_output=True,
                              text=True, env={**env, "PYTHONPATH": str(root)})
        assert proc.returncode == 0, proc.stderr[-800:]
    finally:
        shutil.rmtree(root, ignore_errors=True)


def test_contracts_search_survives_unreadable_parents(monkeypatch):
    """Python 3.12 raises PermissionError from Path.is_dir() under an unreadable /root (3.13
    returns False); CI runs 3.12 as a different user."""
    from pathlib import Path

    real = Path.is_dir

    def deny(self):
        if "packages" in self.parts and "quellix_worker" in self.parts:
            raise PermissionError(13, "Permission denied", str(self))
        return real(self)

    monkeypatch.setattr(Path, "is_dir", deny)
    assert modal_app.contracts_dir("/root/quellix_worker/modal_app.py") is None


def test_hands_weights_pin_matches_the_hands_package():
    from quellix_hands import weights

    assert modal_app.HANDS_URL == weights.MEDIAPIPE_URL
    assert modal_app.HANDS_SHA256 == weights.MEDIAPIPE_SHA256
    assert len(weights.MEDIAPIPE_SHA256) == 64
