import json
import subprocess
import sys
from pathlib import Path

import pytest

from quellix_worker import media
from quellix_worker.checks import task_baseline as tb
from quellix_worker.contracts import load_example, validate_decision
from quellix_worker.pipeline import Dependencies, PipelineConfig, run_pipeline

from .clips import scene, write_clip

RUBRIC = load_example("rubric.load_dishwasher.json")
LENIENT = {**RUBRIC, "checks": {
    "technical": {"critical": False}, "framing": {"enabled": False},
    "privacy": {"enabled": False}, "hands_visible": {"enabled": False},
    "task_completed": {"critical": True}, "originality": {}}}


class FakeJudge:
    name = "baseline:fake"

    def __init__(self, completed=True, confidence=0.9):
        self.calls = 0
        self.j = tb.TaskJudgement(completed, confidence, 1.0, 5.0, cost_usd=0.01,
                                  model="baseline:fake")

    def judge(self, path, prompt, duration_s):
        self.calls += 1
        assert "Load dirty plates" in prompt and "close the door" in prompt
        return self.j


@pytest.fixture(scope="module")
def clip(tmp_path_factory):
    return write_clip(tmp_path_factory.mktemp("p") / "c.mp4", scene(8, 60))


def test_not_decodable_rejects(tmp_path):
    bad = tmp_path / "bad.mp4"
    bad.write_bytes(b"junk")
    r = run_pipeline(bad, RUBRIC, "v1")
    assert r.decision["decision"] == "reject"
    assert [x["code"] for x in r.decision["reasons"]] == ["technical.not_decodable"]
    for name in ("originality", "privacy", "framing", "hands_visible", "task_completed"):
        assert r.decision["checks"][name]["status"] == "skipped"


def test_critical_fail_skips_task(clip):
    judge = FakeJudge()
    r = run_pipeline(clip, RUBRIC, "v1", PipelineConfig(allow_external_models=True),
                     Dependencies(task_judge=judge))
    assert r.decision["decision"] == "reject" and judge.calls == 0
    assert r.decision["checks"]["task_completed"]["status"] == "skipped"
    assert not any(x["check"] == "task_completed" for x in r.decision["reasons"])
    validate_decision(r.decision)


def test_task_judge_used_when_allowed_and_cost_recorded(clip):
    judge = FakeJudge()
    deps = Dependencies(task_judge=judge, face_detector=type("F", (), {
        "detect": lambda self, rgb: []})())
    r = run_pipeline(clip, LENIENT, "v1", PipelineConfig(allow_external_models=True), deps)
    assert judge.calls == 1 and r.cost["api_usd"] == 0.01
    assert r.decision["checks"]["task_completed"]["status"] == "pass"
    assert r.models["task_completed"] == "baseline:fake"


def test_external_model_not_called_without_consent(clip):
    judge = FakeJudge()
    r = run_pipeline(clip, LENIENT, "v1", PipelineConfig(), Dependencies(task_judge=judge))
    assert judge.calls == 0
    assert r.decision["checks"]["task_completed"]["status"] == "error"  # -> review, intended
    assert r.decision["decision"] != "accept"


def test_hands_placeholder_never_accepts(clip):
    rub = {**LENIENT, "checks": {**LENIENT["checks"], "hands_visible": {}}}
    r = run_pipeline(clip, rub, "v1", PipelineConfig(allow_external_models=True),
                     Dependencies(task_judge=FakeJudge()))
    assert r.decision["decision"] == "review"


def test_prompt_and_parse():
    p = tb.build_prompt(RUBRIC)
    assert "Expected steps" in p and "Expected final state" in p
    j = tb.parse_judgement('```json\n{"completed": null, "confidence": 2}\n```', 0.0, "m")
    assert j.completed is None and j.confidence == 1.0
    with pytest.raises(ValueError):
        tb.parse_judgement('{"completed": "yes"}', 0.0, "m")


def test_task_run_provider_failure_is_error(tmp_path):
    class Boom:
        name = "baseline:boom"

        def judge(self, *a):
            raise RuntimeError("quota")

    out, cost = tb.run(RUBRIC, tmp_path / "x", 10, Boom())
    assert out.error and "quota" in out.error and cost == 0.0


def test_gemini_mocked_transport(tmp_path):
    import httpx

    def handler(req: httpx.Request) -> httpx.Response:
        u = str(req.url)
        if req.headers.get("X-Goog-Upload-Command") == "start":
            return httpx.Response(200, headers={"x-goog-upload-url": "https://up.test/u"})
        if u == "https://up.test/u":
            return httpx.Response(200, json={"file": {"name": "files/1", "uri": "gs://f",
                                                      "state": "ACTIVE"}})
        if "generateContent" in u:
            return httpx.Response(200, json={
                "usageMetadata": {"promptTokenCount": 1_000_000, "candidatesTokenCount": 0},
                "candidates": [{"content": {"parts": [{"text": '{"completed": true,'
                                                       ' "confidence": 0.8}'}]}}]})
        return httpx.Response(200, json={})

    f = tmp_path / "v.mp4"
    f.write_bytes(b"x")
    judge = tb.GeminiJudge("k", httpx.Client(transport=httpx.MockTransport(handler)))
    out, cost = tb.run(RUBRIC, f, 10, judge)
    assert out.measurements["completed"] is True and cost == pytest.approx(0.30)


def test_cli_contract(clip, tmp_path):
    rub = tmp_path / "r.json"
    rub.write_text(json.dumps(RUBRIC))
    rep = tmp_path / "rep.json"
    run = lambda *a: subprocess.run([sys.executable, "-m", "quellix_worker", "check", *a],  # noqa: E731
                                    capture_output=True, text=True)
    p = run(str(clip), "--rubric", str(rub), "--video-id", "abc", "--report", str(rep))
    assert p.returncode == 0
    decision = json.loads(p.stdout)  # stdout is only the decision
    validate_decision(decision)
    assert decision["video_id"] == "abc"
    report = json.loads(rep.read_text())
    assert set(report) == {"decision", "cost_usd", "timings_ms", "models"}
    assert "technical" in report["timings_ms"] and report["models"]["technical"]
    assert run("missing.mp4", "--rubric", str(rub)).returncode == 2
    bad = tmp_path / "bad.json"
    bad.write_text("{}")
    assert run(str(clip), "--rubric", str(bad)).returncode == 2
    assert run().returncode == 2


def test_decode_helper_is_reused(clip):
    assert media.decode(clip).info.decodable
    assert Path(clip).exists()


def test_modal_app_imports_without_credentials():
    import quellix_worker.modal_app as m

    assert m.GPU is None  # CPU by default
    assert m.app is None or m.app.name == "quellix-worker"


def test_cli_fingerprint_db_finds_duplicate_across_runs(clip, tmp_path):
    rub = tmp_path / "r.json"
    rub.write_text(json.dumps(RUBRIC))
    db = tmp_path / "fp.pkl"

    def check(video_id: str) -> dict:
        p = subprocess.run([sys.executable, "-m", "quellix_worker", "check", str(clip),
                            "--rubric", str(rub), "--video-id", video_id,
                            "--fingerprint-db", str(db)], capture_output=True, text=True)
        assert p.returncode == 0, p.stderr
        return json.loads(p.stdout)

    first = check("original")
    assert first["checks"]["originality"]["measurements"]["match_video_id"] is None
    assert db.exists()
    second = check("reupload")
    m = second["checks"]["originality"]["measurements"]
    assert m["match_video_id"] == "original" and m["max_similarity"] >= 0.9
    assert second["decision"] == "reject"
    assert any(r["code"] == "originality.duplicate" for r in second["reasons"])
