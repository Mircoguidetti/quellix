import json
from pathlib import Path

import pytest

from quellix_eval.datasets.manifest import ClipRecord, TaskSpec, write_manifest
from quellix_eval.defects import make_clean_clip, write_video
from quellix_eval.defects.build import build_variants
from quellix_eval.run import DEFAULT_RUBRIC

FIXTURE_VARIANTS = ["hands_out", "truncated", "blur", "underexposed", "overexposed",
                    "document", "dup_mirror"]


@pytest.fixture
def fixture_set(tmp_path: Path) -> Path:
    """Tiny generated set (2 clean + 2 x 7 defects = 16 clips) and a lenient rubric."""
    clean = []
    for i in range(2):
        p = tmp_path / f"clean{i}.mp4"
        c = make_clean_clip(seed=i)
        write_video(p, c.frames, c.fps)
        clean.append(ClipRecord(
            clip_id=f"clean{i}", source="synthetic", license="synthetic", path=str(p),
            task=TaskSpec(description="move the block down", steps=["move"], final_state="down"),
            truth="accept", labels_source="synthetic",
            # Generated clips have no real hands: that label is unknown, not "pass".
            checks={"hands_visible": "unknown", "task_completed": "pass", "technical": "pass"}))
    records = build_variants(clean, tmp_path / "variants", FIXTURE_VARIANTS)
    write_manifest(records, tmp_path / "m.jsonl")
    rubric = json.loads(DEFAULT_RUBRIC.read_text())
    t = rubric["checks"]["technical"]
    t.update(min_duration_s=1, min_width=64, min_height=48, min_fps=10)
    (tmp_path / "rubric.json").write_text(json.dumps(rubric))
    return tmp_path
