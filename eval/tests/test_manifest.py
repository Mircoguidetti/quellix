import pytest
from pydantic import ValidationError

from quellix_eval.datasets.manifest import ClipRecord, TaskSpec, load_manifest, write_manifest


def rec(**kw):
    base = dict(clip_id="a", source="x", license="apache-2.0", path="p",
                task=TaskSpec(description="d"), truth="accept")
    return ClipRecord(**{**base, **kw})


def test_roundtrip(tmp_path):
    rs = [rec(), rec(clip_id="b", truth="reject", checks={"hands_visible": "fail"})]
    assert write_manifest(rs, tmp_path / "m.jsonl") == 2
    assert load_manifest(tmp_path / "m.jsonl") == rs


@pytest.mark.parametrize("name", ["EPIC-KITCHENS-100", "ego4d", "Ego-Exo4D"])
def test_non_commercial_sources_rejected(name):
    with pytest.raises(ValidationError):
        rec(source=name)
    with pytest.raises(ValidationError):
        rec(license=name)


def test_unknown_license_rejected():
    with pytest.raises(ValidationError):
        rec(license="cc-by-nc-4.0")


def test_duplicate_ids_and_bad_lines_report_location(tmp_path):
    p = tmp_path / "m.jsonl"
    write_manifest([rec()], p)
    line = p.read_text()
    p.write_text(line + line)
    with pytest.raises(ValueError, match="m.jsonl:2.*duplicate"):
        load_manifest(p)
    p.write_text("{bad\n")
    with pytest.raises(ValueError, match="m.jsonl:1"):
        load_manifest(p)


def test_labels_source_and_unknown_label():
    r = rec(labels_source="synthetic", checks={"hands_visible": "unknown"})
    assert r.labels_source == "synthetic" and rec().labels_source == "human"
    with pytest.raises(ValidationError):
        rec(labels_source="guess")
