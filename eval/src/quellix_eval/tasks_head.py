"""The first trained task head (models/tasks), measured once on the benchmark's tasks slice.

    python -m quellix_eval.tasks_head val-ids  --baseline B.json --out DIR      # no video download
    python -m quellix_eval.tasks_head build    --split train --sessions N --out DIR [--tolerant]
    python -m quellix_eval.tasks_head check-ids --manifest M.jsonl --baseline B.json
    python -m quellix_eval.tasks_head score    --manifest M --head H --cmd quellix-tasks --out DIR
    python -m quellix_eval.tasks_head wrap-report --stage train ... --out R.json
    python -m quellix_eval.tasks_head report   --scored S.json --baseline B.json --train T.json ...

Driven by `.github/workflows/tasks-train.yml`. It spends nothing: HoloAssist is read over public
HTTP, SigLIP 2 comes from the public Hugging Face repository, no model API is called.
Training (`quellix_tasks.train`) lives in the models/tasks environment; this module never imports
it. The head is committed before the validation clips are built, so no validation decision can
influence a threshold.
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
import time
import zipfile
from collections.abc import Mapping, Sequence
from io import BytesIO
from pathlib import Path
from typing import Any

import httpx

from .benchmark import holo
from .benchmark.runner import RUBRICS, holo_clips, run_worker
from .benchmark.stats import Rate, decision_pair, metrics
from .datasets.manifest import load_manifest, write_manifest
from .review_anatomy import TARGET_DECIDED, TARGET_FAR, TARGET_FRR, gap

VAL_SESSIONS = 130
VAL_SEED = 64
TRAIN_SEED = 64
TEE_TIMEOUT_S = 580      # inside the 600 s of run.worker_engine, so the child dies first
STAGE_BUDGET_S = 3.5 * 3600
RUBRIC = "benchmark_v2_tasks.json"
GEMINI = ("gemini:gemini-3.1-flash-lite", "gemini:gemini-3.1-pro-preview")


# --- clip ids and splits ------------------------------------------------------------------


def expected_task_ids(ann: Mapping[str, Sequence[Mapping[str, Any]]],
                      splits: Mapping[str, Sequence[str]], split: str, n: int,
                      seed: int) -> list[str]:
    """Clip ids `holo.task_clips` would write for `holo_clips(split=...)`, from annotations and
    splits alone (no video). A session whose video is missing from the release tar is the only
    case this cannot see; the comparison with the real manifest catches it."""
    pool = [s for s in splits.get(split, []) if s in ann]
    ids: list[str] = []
    for session in holo.pick_sessions(pool, n, seed):
        events = ann[session]
        if not holo.fine_actions(events):
            continue
        if not holo.has_uncorrected_mistake(events):
            ids.append(f"holo_task_{session}_full")
        ids.append(f"holo_task_{session}_cut")
    return ids


def compare_ids(found: Sequence[str], baseline: Mapping[str, Any]) -> dict[str, Any]:
    want = set(baseline["clips"])
    got = set(found)
    return {"equal": got == want and len(found) == len(got), "found": len(found),
            "baseline": len(want), "only_found": sorted(got - want),
            "only_baseline": sorted(want - got), "duplicates": len(found) - len(got)}


def splits_info(data: bytes) -> dict[str, Any]:
    """What the official split archive says about itself (members, any README text)."""
    with zipfile.ZipFile(BytesIO(data)) as z:
        names = z.namelist()
        readme = {n: z.read(n).decode("utf-8", "replace")[:3000]
                  for n in names if "readme" in n.lower() or n.lower().endswith(".md")}
        sizes = {n: len([ln for ln in z.read(n).decode().splitlines() if ln.strip()])
                 for n in names if n.endswith(".txt")}
    return {"members": names, "lines_per_txt_member": sizes, "readme": readme}


def _fetch(client: httpx.Client, url: str) -> bytes:
    return client.get(url).raise_for_status().content


def cmd_val_ids(a: argparse.Namespace) -> int:
    client = httpx.Client(timeout=300, follow_redirects=True)
    ann = holo.load_annotations(json.loads(_fetch(client, holo.ANNOTATIONS_URL)))
    raw_splits = _fetch(client, holo.SPLITS_URL)
    ids = expected_task_ids(ann, holo.load_splits(raw_splits), "val", a.sessions, a.seed)
    res = compare_ids(ids, json.loads(a.baseline.read_text()))
    a.out.mkdir(parents=True, exist_ok=True)
    (a.out / "val-ids.json").write_text(json.dumps(res, indent=1) + "\n")
    (a.out / "splits-info.json").write_text(json.dumps(splits_info(raw_splits), indent=1) + "\n")
    print(json.dumps({k: v for k, v in res.items() if not k.startswith("only_")}))
    if not res["equal"]:
        print("expected validation clip ids differ from the baseline:", file=sys.stderr)
        print(json.dumps(res, indent=1)[:4000], file=sys.stderr)
        return 1
    return 0


def cmd_build(a: argparse.Namespace) -> int:
    started = time.monotonic()
    work = a.out.resolve() / "work"
    work.mkdir(parents=True, exist_ok=True)
    client = httpx.Client(timeout=300, follow_redirects=True)
    cache = Path(os.environ.get("QUELLIX_HOLO_CACHE", a.out / "cache"))
    remote = holo.Remote(cache, client)
    clips, stats = holo_clips("tasks", a.sessions, work, a.seed, remote, client,
                              split=a.split, tolerant=a.tolerant)
    stats["clips"] = len(clips)
    stats["sessions_requested"] = a.sessions
    stats["clip_build_s"] = round(time.monotonic() - started, 1)
    write_manifest(clips, a.out / "manifest.jsonl")
    (a.out / "build-stats.json").write_text(json.dumps(stats, indent=1) + "\n")
    print(json.dumps(stats))
    return 0 if clips else 1


def cmd_manifest_from_annotations(a: argparse.Namespace) -> int:
    """The manifest `build` would write for the train split, without any video: clip ids,
    windows and task text come from the annotations alone (the cutter is a stub). Used to find
    the cached training embeddings again, which are keyed by clip id + window."""
    client = httpx.Client(timeout=300, follow_redirects=True)
    ann = holo.load_annotations(json.loads(_fetch(client, holo.ANNOTATIONS_URL)))
    splits = holo.load_splits(_fetch(client, holo.SPLITS_URL))
    pool = [s for s in splits.get(a.split, []) if s in ann]
    recs = []
    for session in holo.pick_sessions(pool, a.sessions, a.seed):
        recs += holo.task_clips(session, ann[session], Path("none.mp4"), Path("not-built"),
                                cutter=lambda _s, _d, start, end: end - start)
    write_manifest(recs, a.out)
    print(json.dumps({"clips": len(recs), "sessions": a.sessions}))
    return 0 if recs else 1


def cmd_check_ids(a: argparse.Namespace) -> int:
    clips = load_manifest(a.manifest)
    base = json.loads(a.baseline.read_text())
    res = compare_ids([c.clip_id for c in clips], base)
    res["truth_mismatch"] = sorted(c.clip_id for c in clips
                                   if base["clips"].get(c.clip_id) not in (None, c.truth))
    print(json.dumps({k: v for k, v in res.items() if not k.startswith("only_")}))
    if not res["equal"] or res["truth_mismatch"]:
        print(json.dumps(res, indent=1)[:4000], file=sys.stderr)
        return 1
    return 0


# --- scoring ------------------------------------------------------------------------------


def tee(argv: Sequence[str]) -> int:
    """`tee DIR -- CMD...`: run the worker command unchanged and keep its decision JSON in
    DIR/<video-id>.json (the runner's summary drops the measurements, `p_completed` included)."""
    out_dir = Path(argv[0])
    cmd = list(argv[argv.index("--") + 1:])
    try:
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=TEE_TIMEOUT_S)
    except subprocess.TimeoutExpired:
        print(f"timeout after {TEE_TIMEOUT_S} s", file=sys.stderr)
        return 1
    if "--video-id" in cmd and proc.returncode == 0:
        out_dir.mkdir(parents=True, exist_ok=True)
        vid = cmd[cmd.index("--video-id") + 1]
        (out_dir / f"{vid}.json").write_text(proc.stdout)
        if "--rubric" in cmd:      # the exact rubric run_worker built for this clip
            shutil.copyfile(cmd[cmd.index("--rubric") + 1], out_dir / f"{vid}.rubric.json")
    sys.stdout.write(proc.stdout)
    sys.stderr.write(proc.stderr)
    return proc.returncode


def task_measurements(decision: Mapping[str, Any] | None) -> dict[str, Any]:
    if not decision:
        return {}
    return dict(decision.get("checks", {}).get("task_completed", {}).get("measurements", {}))


def cmd_score(a: argparse.Namespace) -> int:
    clips = load_manifest(a.manifest)[: a.limit]
    rubric = json.loads((a.rubric or RUBRICS / RUBRIC).read_text())
    os.environ["QUELLIX_TASKS_HEAD"] = str(a.head.resolve())
    decisions = a.out / "decisions"
    wrapped = [sys.executable, "-m", "quellix_eval.tasks_head", "tee", str(decisions), "--",
               *a.cmd]
    started = time.monotonic()
    results = run_worker(clips, rubric, started + a.budget_s, parallel=1, cmd=wrapped)
    elapsed = time.monotonic() - started
    rows = []
    for c in clips:
        r = results[c.clip_id]
        f = decisions / f"{c.clip_id}.json"
        m = task_measurements(json.loads(f.read_text())) if f.exists() else {}
        rows.append({"clip_id": c.clip_id, "truth": c.truth, "decision": r.decision,
                     "checks": r.checks, "error": r.error, "not_run": r.not_run,
                     "latency_s": None if r.latency_s is None else round(r.latency_s, 1),
                     "p_completed": m.get("p_completed"), "completed": m.get("completed"),
                     "missing_steps": len(m.get("missing_steps", []))})
    a.out.mkdir(parents=True, exist_ok=True)
    head = json.loads(a.head.read_text())
    (a.out / "scored.json").write_text(json.dumps({
        "head": str(a.head), "head_version": head.get("version"),
        "thresholds": {"reject_at": head.get("reject_at"), "accept_at": head.get("accept_at")},
        "cmd": list(a.cmd), "rubric": rubric.get("id"), "rubric_version": rubric.get("version"),
        "budget_s": a.budget_s, "elapsed_s": round(elapsed, 1), "parallel": 1,
        "env": {k: os.environ.get(k) for k in ("HF_HOME", "HF_HUB_OFFLINE")},
        "rows": rows}, indent=1) + "\n")
    ran = [r for r in rows if not r["not_run"]]
    print(json.dumps({"clips": len(rows), "ran": len(ran), "elapsed_s": round(elapsed, 1),
                      "s_per_clip": round(elapsed / max(len(ran), 1), 1),
                      "errors": sum(1 for r in ran if r["error"])}))
    return 0 if ran else 1


# --- reports ------------------------------------------------------------------------------


def cmd_wrap_report(a: argparse.Namespace) -> int:
    """The committed report of a train / smoke run: who ran, how long, what came out."""
    head = json.loads(a.head.read_text()) if a.head and a.head.exists() else {}
    raw = json.loads(a.raw.read_text()) if a.raw and a.raw.exists() else None
    out: dict[str, Any] = {
        "stage": a.stage, "status": "complete" if raw and head else "incomplete",
        "train_sessions": a.sessions, "head_version": head.get("version"),
        "head_file": a.head.name if a.head else None, "commit": a.commit, "run_id": a.run_id,
        "timings_s": dict(kv.split("=", 1) for kv in a.timing),
        "build": json.loads(a.build.read_text()) if a.build and a.build.exists() else None,
        "train": raw,
    }
    out["timings_s"] = {k: float(v) for k, v in out["timings_s"].items()}
    for item in a.include:
        name, path = item.split("=", 1)
        p = Path(path)
        out[name] = json.loads(p.read_text()) if p.exists() else None
    if a.stage == "smoke":
        out["sizing"] = sizing(out)
    a.out.parent.mkdir(parents=True, exist_ok=True)
    a.out.write_text(json.dumps(out, indent=1) + "\n")
    print(json.dumps({k: out[k] for k in ("stage", "status", "head_version")}
                     | {"sizing": out.get("sizing")}))
    return 0


def sizing(report: Mapping[str, Any]) -> dict[str, Any] | None:
    """Sessions that fit a job of STAGE_BUDGET_S, from the smoke run's measured throughput."""
    t = report.get("timings_s", {})
    b = report.get("build") or {}
    tr = report.get("train") or {}
    sessions, clips = report.get("train_sessions"), tr.get("clips")
    if not (sessions and clips and "train_s" in t and b.get("clip_build_s")):
        return None
    build_per_session = b["clip_build_s"] / sessions
    embed_per_clip = t["train_s"] / clips          # includes loading SigLIP once: an upper bound
    clips_per_session = clips / sessions
    fixed = t.get("setup_s", 0.0)
    avail = 0.85 * STAGE_BUDGET_S - fixed
    per_session = build_per_session + clips_per_session * embed_per_clip
    return {"build_s_per_session": round(build_per_session, 1),
            "embed_s_per_clip": round(embed_per_clip, 2),
            "clips_per_session": round(clips_per_session, 2), "setup_s": fixed,
            "budget_s": STAGE_BUDGET_S, "margin": 0.15,
            "suggested_train_sessions": max(0, int(avail / per_session))}


def _table(head: Sequence[str], rows: Sequence[Sequence[Any]]) -> list[str]:
    out = ["| " + " | ".join(head) + " |", "|" + "---|" * len(head)]
    out += ["| " + " | ".join(str(c) for c in r) + " |" for r in rows]
    return out + [""]


def _split(rows: Sequence[Mapping[str, Any]]) -> dict[str, dict[str, int]]:
    out = {"accept": {"accept": 0, "reject": 0, "review": 0},
           "reject": {"accept": 0, "reject": 0, "review": 0}}
    for r in rows:
        out[r["truth"]][r["decision"] if r["decision"] in ("accept", "reject") else "review"] += 1
    return out


def row_metrics(rows: Sequence[Mapping[str, Any]]):
    return metrics(decision_pair(r["truth"], r["decision"]) for r in rows)


def decided(rows: Sequence[Mapping[str, Any]]) -> Rate:
    return Rate(sum(1 for r in rows if r["decision"] in ("accept", "reject")), len(rows))


def precision_at_recall(rows: Sequence[Mapping[str, Any]], target: float):
    """Exploratory: move the reject cut on `p_completed` (reject when p <= cut) to the smallest
    cut whose rejection recall reaches `target`. -> (cut, precision Rate, recall Rate) or None."""
    neg = sum(1 for r in rows if r["truth"] == "reject")
    scored = sorted((r["p_completed"], r["truth"]) for r in rows if r["p_completed"] is not None)
    if not neg or not scored:
        return None
    tp = fp = 0
    for i, (p, truth) in enumerate(scored):
        tp, fp = (tp + 1, fp) if truth == "reject" else (tp, fp + 1)
        nxt = scored[i + 1][0] if i + 1 < len(scored) else None
        if nxt == p:
            continue                                  # ties: the cut takes all of them
        if tp / neg >= target:
            return p, Rate(tp, tp + fp), Rate(tp, neg)
    return None


def _wrong(rows: Sequence[Mapping[str, Any]]) -> list[Mapping[str, Any]]:
    return [r for r in rows if (r["truth"] == "reject" and r["decision"] == "accept")
            or (r["truth"] == "accept" and r["decision"] == "reject")]


def _held_out(m: Mapping[str, Any] | None) -> str:
    if not m:
        return "n/a"
    prec = "n/a" if m.get("reject_precision") is None else f"{m['reject_precision']:.2f}"
    return (f"n={m['n']}; reject precision {prec}; reject recall {m['reject_recall']:.2f}; "
            f"false accept {m['false_accept_rate']:.2f}; false reject "
            f"{m['false_reject_rate']:.2f}; review {m['review_rate']:.2f}")


def render_checks(c: Mapping[str, Any] | None) -> list[str]:
    """Section 'Checks before scoring' from models/tasks/heads/checks.json."""
    if not c:
        return ["## Checks before scoring", "", "Not run.", ""]
    f, sv = c["features"], c.get("serve")
    rep, san, sh = f["reproduces_head"], f["real_head"], f["shuffle_control"]
    lines = ["## Checks before scoring", "",
             "Run before any validation clip was built or scored; no threshold was changed. "
             f"Overall: `passed = {c['passed']}`. The training run did not save its feature "
             "matrix, so it was rebuilt from the cached embeddings (keyed by clip id + window) "
             "and shown to be the matrix the head was fitted on (check 0).", ""]
    lines += ["### 0. The rebuilt matrix is the one the head was fitted on", ""]
    lines += _table(["item", "value"], [
        ["clips in manifest / dataset / training report",
         f"{f['manifest_clips']} / {f['dataset_clips']} / {f['train_report_clips']}"],
        ["refit on the matrix vs committed head: max abs difference of weights, bias, mean, "
         "scale, thresholds", f"{rep['max_abs_diff']:.2e} (tolerance {rep['tolerance']:.0e}); "
         f"ok = {rep['ok']}"]])
    if sv is None:
        lines += ["### 1. Train/serve consistency", "",
                  "Not run: a check on the feature matrix failed first (below), and the stage "
                  "stops there.", ""]
    else:
        lines += _serve_lines(sv)
    lines += ["### 2. Label-shuffle control and 3. sanity of the real head", "",
              "Out-of-fold (5 folds grouped by session, seed 0, same settings). Shuffle: labels "
              f"permuted over the training set, grouping kept, {sh['permutations']} permutations; "
              f"pass if the first permutation's AUC is within {sh['bands']['first']} and the mean "
              f"within {sh['bands']['mean']} (bands fixed before the run).", ""]
    return lines + _real_head_lines(san, sh)


def _serve_lines(sv: Mapping[str, Any]) -> list[str]:
    lines = ["### 1. Train/serve consistency", "",
              f"{sv['clips_compared']} training clips were rebuilt and run through the scoring "
              "route (`quellix-tasks check`, `QUELLIX_TASKS_HEAD`, rubric built per clip as "
              "`run_worker` does). `p_completed` returned by the route vs `head.proba` of the "
              "training-time features of the same clip id:", ""]
    lines += _table(["item", "value"], [
        ["maximum absolute difference", f"{sv['max_abs_diff']}"],
        ["tolerance", f"{sv['tolerance']}"],
        ["task text (description, steps, final state) identical to the training manifest",
         str(sv["all_task_text_equal"])],
        ["clips without `p_completed` / not in the training features",
         f"{len(sv['no_p_completed'])} / {len(sv['problems'])}"],
        ["ok", str(sv["ok"])]])
    lines += ["The \"training-time\" text is the manifest rebuilt by the same code from the same "
              "annotations (the manifest of the training job was not saved); the scoring-time text "
              "is the rubric the route actually received.", ""]
    return lines


def _real_head_lines(san: Mapping[str, Any], sh: Mapping[str, Any]) -> list[str]:
    lines: list[str] = []
    cm = san["confusion_oof_at_head_thresholds"]
    lines += _table(["measure", "real labels", "shuffled labels"], [
        ["out-of-fold AUC (completed vs not)", san["oof_auc"],
         f"mean {sh['oof_auc_mean']} (min {sh['oof_auc_min']}, max {sh['oof_auc_max']}); "
         f"first {sh['oof_auc'][0]}"],
        ["mean out-of-fold p_completed, completed clips", san["oof_mean_p_completed"], ""],
        ["mean out-of-fold p_completed, not-completed clips", san["oof_mean_p_not_completed"],
         ""],
        ["out-of-fold metrics at thresholds fitted on them (first permutation)", "",
         _held_out(sh["first_permutation_report"]["out_of_fold_all"])],
        ["ok", str(san["ok"]), str(sh["ok"])]])
    lines += ["Confusion of the real out-of-fold probabilities at the head's thresholds "
              f"(`{json.dumps(san['thresholds'])}`; fitted on these same probabilities, so "
              "optimistic):", ""]
    lines += _table(["truth", "accept", "reject", "review"], [
        [k, v["accept"], v["reject"], v["review"]] for k, v in cm.items()])
    return lines


def render(scored: Mapping[str, Any], baseline: Mapping[str, Any], train: Mapping[str, Any],
           smoke: Mapping[str, Any] | None, meta: Mapping[str, Any],
           checks: Mapping[str, Any] | None = None) -> str:
    rows = [r for r in scored["rows"] if not r["not_run"]]
    by_id = {r["clip_id"]: r for r in rows}
    lines = ["# Task head v1: first trained head, scored once on the benchmark tasks slice", "",
             "A measurement of where the task model stands, not a verdict on the product. The head "
             "(`models/tasks/heads/head-v1.json`) is a candidate artifact and is not enabled in "
             "the worker. Every number is regenerated by `python -m quellix_eval.tasks_head "
             "report` from the files named below.", ""]

    lines += ["## Provenance", ""]
    tt = train.get("timings_s", {})
    lines += _table(["item", "value"], [
        ["score run", f"{meta.get('run_id')} on commit `{meta.get('commit')}`"],
        ["train run", f"{train.get('run_id')} on commit `{train.get('commit')}`"],
        ["smoke run", f"{(smoke or {}).get('run_id')} on commit `{(smoke or {}).get('commit')}`"],
        ["head", f"`{train.get('head_file')}` version `{train.get('head_version')}`"],
        ["rubric", f"`{scored.get('rubric')}` v{scored.get('rubric_version')} "
                   "(`eval/rubrics/benchmark_v2_tasks.json`)"],
        ["encoder", "SigLIP 2 base (`google/siglip2-base-patch16-224`), CPU, 1 fps, "
                    "GitHub-hosted `ubuntu-latest` runner"],
        ["spend", "$0: no paid API, no secret; public repository, GitHub-hosted runner"]])

    b = train.get("build") or {}
    tr = train.get("train") or {}
    lines += ["## Training", "",
              f"- Train sessions requested: {train.get('train_sessions')} (HoloAssist **train** "
              f"split, seed {TRAIN_SEED}, round-robin over the 20 tasks); clips built: "
              f"{b.get('clips')}; used by the head: {tr.get('clips')} "
              f"({tr.get('completed')} completed, {tr.get('not_completed')} not completed).",
              f"- Skipped while building: `{json.dumps(b.get('skipped', {}))}`.",
              f"- Time: clip build {tt.get('build_s', b.get('clip_build_s'))} s, embeddings + "
              f"fit {tt.get('train_s')} s, whole job setup {tt.get('setup_s')} s.",
              (f"- Sizing from the smoke run: {json.dumps((smoke or {}).get('sizing'))}."),
              f"- Settings (fixed defaults, not tuned): `{json.dumps(tr.get('settings'))}`.",
              f"- Chosen thresholds (fitted on train out-of-fold probabilities, grouped by "
              f"session): `{json.dumps(tr.get('thresholds'))}`.", ""]
    lines += _table(["train-side number (not the validation result)", "value"], [
        ["out-of-fold, all train clips (thresholds were fitted on these)",
         _held_out(tr.get("out_of_fold_all"))],
        ["internal 20% held-out train sessions", _held_out(tr.get("held_out"))],
        ["same held-out clips, untrained default head",
         _held_out(tr.get("held_out_untrained_head"))]])

    lines += render_checks(checks)

    n = len(rows)
    not_run = len(scored["rows"]) - n
    sp = _split(rows)
    m = row_metrics(rows)
    dec = decided(rows)
    lines += ["## Validation: the 255 clips of the benchmark tasks slice", "",
              f"HoloAssist **val** split, 130 sessions, seed {VAL_SEED}. The clip ids were "
              "compared with the ids in `eval/reports/data/benchmark-v2-tasks-gemini.json` before "
              "scoring (identical). Scored once; nothing was tuned on these clips. "
              f"Clips scored: {n}; not run (time budget): {not_run}. Route: `run_worker` "
              f"(parallel 1, budget {scored.get('budget_s')} s, elapsed {scored.get('elapsed_s')} "
              f"s), head via `QUELLIX_TASKS_HEAD`, `HF_HUB_OFFLINE=1`.", ""]
    lines += _table(["truth", "accept", "reject", "review", "n"], [
        ["good (task completed)", *(sp["accept"][k] for k in ("accept", "reject", "review")),
         sum(sp["accept"].values())],
        ["bad (task not completed)", *(sp["reject"][k] for k in ("accept", "reject", "review")),
         sum(sp["reject"].values())]])
    lines += _table(["measure", "value (Wilson 95%)", "reference target", "gap (points)"], [
        ["base reject rate", m.base_reject_rate.fmt(), "", ""],
        ["decided without a person", dec.fmt(), ">= 70%", gap(dec, TARGET_DECIDED, True)],
        ["false accept rate", m.false_accept_rate.fmt(), "<= 2%",
         gap(m.false_accept_rate, TARGET_FAR, False)],
        ["false reject rate", m.false_reject_rate.fmt(), "<= 5%",
         gap(m.false_reject_rate, TARGET_FRR, False)],
        ["reject precision", m.reject_precision.fmt(), "", ""],
        ["reject recall", m.reject_recall.fmt(), "", ""],
        ["review rate", m.review_rate.fmt(), "", ""]])
    lines += ["The reference targets and the gap measure were fixed before any data was read "
              "(`review_anatomy.py`): a gap is the number of points by which the estimate is on "
              "the wrong side of the target; it is not computed when the denominator is under "
              "30. They are a gap measure, not a test.", ""]
    errs = [r for r in rows if r["error"]]
    if errs:
        lines += [f"{len(errs)} clips ended in an error and count as review: "
                  f"{', '.join(sorted({(r['error'] or '')[:80] for r in errs})[:3])}.", ""]

    lines += ["## Head to head with Gemini on the same clips", "",
              "Gemini rows are read from `eval/reports/data/benchmark-v2-tasks-gemini.json` "
              "(benchmark v2 run 39783934037). Each model scored a different subset, so each "
              "block compares both sides on that subset only; the task model's decisions are "
              "the ones above, restricted to the same ids. Different subsets are not "
              "comparable with each other.", ""]
    for eng in GEMINI:
        e = baseline["engines"][eng]
        ids = e["scored_clip_ids"]
        g_rows = [{"clip_id": i, "truth": baseline["clips"][i], "decision": e["decisions"][i]}
                  for i in ids]
        t_rows = [by_id[i] for i in ids if i in by_id]
        gm, tm = row_metrics(g_rows), row_metrics(t_rows)
        lines += [f"### {eng} ({len(ids)} clips scored; task model has {len(t_rows)} of them)",
                  ""]
        lines += _table(["measure", eng, "task head v1"], [
            ["base reject rate", gm.base_reject_rate.fmt(), tm.base_reject_rate.fmt()],
            ["reject precision", gm.reject_precision.fmt(), tm.reject_precision.fmt()],
            ["reject recall", gm.reject_recall.fmt(), tm.reject_recall.fmt()],
            ["false accept rate", gm.false_accept_rate.fmt(), tm.false_accept_rate.fmt()],
            ["false reject rate", gm.false_reject_rate.fmt(), tm.false_reject_rate.fmt()],
            ["decided without a person", decided(g_rows).fmt(), decided(t_rows).fmt()]])
        target = gm.reject_recall.value
        eq = precision_at_recall(t_rows, target) if target is not None else None
        if eq:
            cut, prec, rec = eq
            lines += [f"Exploratory, equal recall (the cut is chosen on these validation clips, "
                      f"so it describes the score, not a deployable setting): moving the task "
                      f"model's reject cut on `p_completed` to {cut:.4f} gives reject recall "
                      f"{rec.fmt()} and reject precision {prec.fmt()}, against Gemini's recall "
                      f"{gm.reject_recall.fmt()} and precision {gm.reject_precision.fmt()}.", ""]
        else:
            lines += ["Exploratory equal-recall comparison: not available (the task model "
                      "never reaches Gemini's recall on these clips).", ""]

    wrong = _wrong(rows)
    lines += ["## Validation clips the head got wrong", "",
              f"{len(wrong)} clips: bad accepted (false accept) or good rejected (false reject). "
              "Reviews are not listed.", ""]
    lines += _table(["clip id", "truth", "decision", "p_completed"], [
        [f"`{r['clip_id']}`", r["truth"], r["decision"], r["p_completed"]] for r in wrong]
        ) if wrong else ["None.", ""]

    lines += ["## What this cannot show", "",
              "- HoloAssist is not collector traffic: guided sessions on 20 fixed tasks, one "
              "device (HoloLens 2), annotated by the dataset's own team.",
              "- Clips are cut by annotation, not by a lab's verdict: a \"completed\" clip is "
              "60 s ending 2 s after the last annotated action, a \"not completed\" clip ends "
              "halfway through it. Cut clips end mid-action, which is easier to see than a "
              "task a contributor really left unfinished.",
              "- **The steps come from the same annotations as the labels** (`holo.task_spec`: "
              "the session's own coarse-grained action sentences). A collector would write the "
              "steps in the rubric, without knowing the annotator's wording. Expect this run to "
              "be easier than a rubric written by a person.",
              "- Train and validation sessions may share scenes or participants. "
              "The official split is by session; what its archive says is in "
              "`splits-info.json` of the smoke run: "
              f"`{json.dumps((smoke or {}).get('splits_info', {}))[:600]}`. Anything it does "
              "not state is not established here.",
              "- Single run, single seed: no variance across seeds, folds or session samples; "
              "the intervals above cover sampling of validation clips only.",
              "- CPU embeddings only (SigLIP 2 base, 1 fps, 224 px); no GPU, no larger encoder, "
              "no temporal model.", ""]
    if meta.get("levers"):
        lines += [meta["levers"], ""]
    return "\n".join(lines)


def cmd_report(a: argparse.Namespace) -> int:
    scored = json.loads(a.scored.read_text())
    text = render(scored, json.loads(a.baseline.read_text()), json.loads(a.train.read_text()),
                  json.loads(a.smoke.read_text()) if a.smoke and a.smoke.exists() else None,
                  {"run_id": a.run_id, "commit": a.commit,
                   "levers": a.levers.read_text() if a.levers and a.levers.exists() else ""},
                  json.loads(a.checks.read_text()) if a.checks and a.checks.exists() else None)
    a.out.parent.mkdir(parents=True, exist_ok=True)
    a.out.write_text(text + "\n")
    print(f"wrote {a.out}")
    return 0


def cmd_checks_report(a: argparse.Namespace) -> int:
    """A report with provenance and the checks only (before any validation clip is scored)."""
    if a.checks and a.checks.exists():
        c = json.loads(a.checks.read_text())
    else:      # a check on the feature matrix failed first; the train/serve check did not run
        c = {"passed": False, "features": json.loads(a.features_check.read_text()),
             "serve": None}
    train = json.loads(a.train.read_text())
    status = ("checks passed, validation not scored yet" if c["passed"] else
              "a check failed: the head was not scored on validation clips")
    lines = ["# Task head v1: first trained head, scored once on the benchmark tasks slice", "",
             f"**Status: {status}.** A measurement of where the task model stands, not a verdict "
             "on the product.", "", "## Provenance", ""]
    lines += _table(["item", "value"], [
        ["check run", f"{a.run_id} on commit `{a.commit}`"],
        ["train run", f"{train.get('run_id')} on commit `{train.get('commit')}`"],
        ["head", f"`{train.get('head_file')}` version `{train.get('head_version')}`, "
                 f"{train.get('train_sessions')} train sessions"]])
    lines += render_checks(c)
    a.out.parent.mkdir(parents=True, exist_ok=True)
    a.out.write_text("\n".join(lines) + "\n")
    return 0


def main(argv: Sequence[str] | None = None) -> int:
    argv = list(sys.argv[1:] if argv is None else argv)
    if argv and argv[0] == "tee":
        return tee(argv[1:])
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawTextHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("val-ids")
    p.add_argument("--baseline", type=Path, required=True)
    p.add_argument("--out", type=Path, required=True)
    p.add_argument("--sessions", type=int, default=VAL_SESSIONS)
    p.add_argument("--seed", type=int, default=VAL_SEED)
    p.set_defaults(fn=cmd_val_ids)
    p = sub.add_parser("build")
    p.add_argument("--split", choices=["train", "val"], required=True)
    p.add_argument("--sessions", type=int, required=True)
    p.add_argument("--seed", type=int, default=None)
    p.add_argument("--out", type=Path, required=True)
    p.add_argument("--tolerant", action="store_true")
    p.set_defaults(fn=cmd_build)
    p = sub.add_parser("manifest-from-annotations")
    p.add_argument("--split", choices=["train", "val"], required=True)
    p.add_argument("--sessions", type=int, required=True)
    p.add_argument("--seed", type=int, default=TRAIN_SEED)
    p.add_argument("--out", type=Path, required=True)
    p.set_defaults(fn=cmd_manifest_from_annotations)
    p = sub.add_parser("checks-report")
    p.add_argument("--checks", type=Path, default=None)
    p.add_argument("--features-check", type=Path, default=None)
    p.add_argument("--train", type=Path, required=True)
    p.add_argument("--commit", default="")
    p.add_argument("--run-id", default="")
    p.add_argument("--out", type=Path, required=True)
    p.set_defaults(fn=cmd_checks_report)
    p = sub.add_parser("check-ids")
    p.add_argument("--manifest", type=Path, required=True)
    p.add_argument("--baseline", type=Path, required=True)
    p.set_defaults(fn=cmd_check_ids)
    p = sub.add_parser("score")
    p.add_argument("--manifest", type=Path, required=True)
    p.add_argument("--head", type=Path, required=True)
    p.add_argument("--out", type=Path, required=True)
    p.add_argument("--budget-s", type=float, required=True)
    p.add_argument("--rubric", type=Path, default=None)
    p.add_argument("--limit", type=int, default=None)
    p.add_argument("--cmd", nargs="+", required=True, help="the quellix-tasks binary")
    p.set_defaults(fn=cmd_score)
    p = sub.add_parser("wrap-report")
    p.add_argument("--stage", choices=["smoke", "train"], required=True)
    p.add_argument("--sessions", type=int, required=True)
    p.add_argument("--head", type=Path, default=None)
    p.add_argument("--raw", type=Path, default=None, help="quellix_tasks.train --report file")
    p.add_argument("--build", type=Path, default=None)
    p.add_argument("--commit", default="")
    p.add_argument("--run-id", default="")
    p.add_argument("--timing", action="append", default=[], help="name=seconds")
    p.add_argument("--include", action="append", default=[], help="key=json file")
    p.add_argument("--out", type=Path, required=True)
    p.set_defaults(fn=cmd_wrap_report)
    p = sub.add_parser("report")
    p.add_argument("--scored", type=Path, required=True)
    p.add_argument("--baseline", type=Path, required=True)
    p.add_argument("--train", type=Path, required=True)
    p.add_argument("--smoke", type=Path, default=None)
    p.add_argument("--levers", type=Path, default=None)
    p.add_argument("--checks", type=Path, default=None)
    p.add_argument("--commit", default="")
    p.add_argument("--run-id", default="")
    p.add_argument("--out", type=Path, required=True)
    p.set_defaults(fn=cmd_report)
    a = ap.parse_args(argv)
    if a.cmd == "build" and a.seed is None:
        a.seed = VAL_SEED if a.split == "val" else TRAIN_SEED
    return a.fn(a)


if __name__ == "__main__":  # pragma: no cover
    sys.exit(main())
