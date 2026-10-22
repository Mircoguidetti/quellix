"""On GitHub Actions, turn each test failure into a one-line ``::error`` annotation, so the
reason can be read through the checks API even where job logs are not accessible."""

from __future__ import annotations

import os


def pytest_runtest_logreport(report):  # pragma: no cover - only active in CI
    if os.environ.get("GITHUB_ACTIONS") != "true" or report.passed or report.skipped:
        return
    path, _, name = report.location[0], report.location[1], report.location[2]
    last = ""
    if report.longrepr is not None:
        lines = [ln for ln in str(report.longrepr).splitlines() if ln.strip()]
        last = " | ".join(lines[-3:])
    msg = f"{name} ({report.when}): {last}"[:900]
    msg = msg.replace("%", "%25").replace("\r", "%0D").replace("\n", "%0A")
    print(f"\n::error file=services/worker/{path},title=pytest failure::{msg}")
