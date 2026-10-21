import json

from quellix_worker.contracts import validate_decision

from quellix_eval.baselines import ModelResponse, run_baseline
from quellix_eval.baselines.common import build_prompt
from quellix_eval.defects import make_clean_clip, write_video
from quellix_eval.run import DEFAULT_RUBRIC

GOOD = {
    "hands_visible": {"ratio_both_manipulation": 0.9, "ratio_any_manipulation": 1.0,
                      "ratio_both_whole": 0.9, "ratio_any_whole": 1.0},
    "framing": {"off_target_ratio": 0.0, "unstable_ratio": 0.0},
    "task_completed": {"completed": True, "confidence": 0.95},
    "privacy": {"faces": [], "documents": [], "screens": []},
    "technical": {"blur_ratio": 0.0, "bad_exposure_ratio": 0.0},
}


class Fake:
    name = "fake"

    def __init__(self, text, cost=0.02):
        self.text, self.cost, self.prompts = text, cost, []

    def generate(self, path, prompt):
        self.prompts.append(prompt)
        return ModelResponse(self.text, self.cost)


def setup(tmp_path):
    c = make_clean_clip(n_frames=24)
    write_video(tmp_path / "v.mp4", c.frames, c.fps)
    rubric = json.loads(DEFAULT_RUBRIC.read_text())
    rubric["checks"]["technical"].update(min_width=64, min_height=48, min_fps=10, min_duration_s=0)
    return tmp_path / "v.mp4", rubric


def test_good_answer_gives_valid_accept_with_cost(tmp_path):
    path, rubric = setup(tmp_path)
    client = Fake("Here you go:\n```json\n" + json.dumps(GOOD) + "\n```")
    res = run_baseline(client, path, rubric, "v1")
    validate_decision(res.decision)
    assert res.decision["decision"] == "accept" and res.cost_usd == 0.02
    assert res.decision["checks"]["hands_visible"]["model"] == "baseline:fake"
    assert "Load dirty plates" in client.prompts[0]


def test_bad_task_answer_rejects(tmp_path):
    path, rubric = setup(tmp_path)
    bad = {**GOOD, "task_completed": {"completed": False, "confidence": 0.9}}
    res = run_baseline(Fake(json.dumps(bad)), path, rubric, "v1")
    assert res.decision["decision"] == "reject"


def test_garbage_answer_goes_to_review_never_accept(tmp_path):
    path, rubric = setup(tmp_path)
    res = run_baseline(Fake("sorry, cannot"), path, rubric, "v1")
    validate_decision(res.decision)
    assert res.decision["decision"] == "review"


def test_missing_check_in_answer_goes_to_review(tmp_path):
    path, rubric = setup(tmp_path)
    partial = {k: v for k, v in GOOD.items() if k != "hands_visible"}
    res = run_baseline(Fake(json.dumps(partial)), path, rubric, "v")
    assert res.decision["decision"] == "review"


def test_prompt_mentions_task():
    assert "Task: x" in build_prompt({"task": {"description": "x"}})
