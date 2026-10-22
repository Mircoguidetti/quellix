"""Blind labelling kit for the Egocentric-10K slice, and the loader for its labels.

    python -m quellix_eval.benchmark.kit --manifest out/synthetic/manifest.jsonl --out kit/

The kit holds the ORIGINAL clips only (no synthetic variants), a static `index.html` that plays
each clip and records the labeller's answers in the browser, and nothing produced by Ormes:
no decision, no measurement, no model name. The labeller exports `labels.jsonl`, which is
committed as `eval/labels/egocentric10k-blind-v1.jsonl` together with who labelled and when.
A run then reports those clips as the "Egocentric-10K: blind human labels" slice.
"""

from __future__ import annotations

import argparse
import html
import json
import shutil
import sys
from collections.abc import Mapping, Sequence
from pathlib import Path
from typing import Any

from ..datasets.manifest import ClipRecord, load_manifest

LABELS = Path(__file__).resolve().parents[3] / "labels" / "egocentric10k-blind-v1.jsonl"
CHECKS = {
    "hands_visible": "Both hands fully visible (wrist to fingertips, not cut by the edge) for "
                     "at least 80% of the time they are working",
    "technical": "Sharp and well exposed enough to see hands and objects",
    "privacy": "No readable document, no screen showing content, no person's face",
    "framing": "Camera points at the work and is stable enough to follow it",
}
REQUIRED_KEYS = {"clip_id", "checks", "truth", "labeller", "labelled_at", "blind"}

PAGE = """<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Blind labels</title>
<style>body{{font:15px system-ui;max-width:900px;margin:2em auto;padding:0 1em}}
video{{width:100%;background:#000}}fieldset{{margin:1em 0}}button{{font:inherit}}</style></head>
<body><h1>Egocentric-10K blind labels</h1>
<p>For each clip, answer from what you see. You are not shown any automatic result, and you
should not look at one before you finish. Answers stay in this browser until you export.</p>
<p><label>Your name: <input id="who"></label></p>
<div id="clips">{clips}</div>
<button onclick="exportLabels()">Export labels.jsonl</button>
<script>
const CHECKS = {checks};
function exportLabels() {{
  const who = document.getElementById('who').value.trim();
  if (!who) {{ alert('Enter your name first'); return; }}
  const lines = [];
  document.querySelectorAll('[data-clip]').forEach(div => {{
    const checks = {{}};
    for (const c of Object.keys(CHECKS)) {{
      const v = div.querySelector(`input[name="${{div.dataset.clip}}:${{c}}"]:checked`);
      checks[c] = v ? v.value : 'unknown';
    }}
    const bad = Object.values(checks).includes('fail');
    const known = Object.values(checks).every(v => v !== 'unknown');
    lines.push(JSON.stringify({{clip_id: div.dataset.clip, checks,
      truth: bad ? 'reject' : (known ? 'accept' : 'unknown'), labeller: who,
      labelled_at: new Date().toISOString(), blind: true}}));
  }});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([lines.join('\\n') + '\\n'], {{type: 'text/plain'}}));
  a.download = 'labels.jsonl'; a.click();
}}
</script></body></html>"""


def build_kit(clips: Sequence[ClipRecord], out: Path) -> int:
    originals = [c for c in clips if "__" not in c.clip_id]
    (out / "clips").mkdir(parents=True, exist_ok=True)
    parts = []
    for c in originals:
        name = f"{c.clip_id}.mp4"
        shutil.copy(c.path, out / "clips" / name)
        qs = "".join(
            f'<p>{html.escape(q)}: '
            + "".join(f'<label><input type="radio" name="{html.escape(c.clip_id)}:{k}" '
                      f'value="{v}"> {t}</label> ' for v, t in
                      (("pass", "yes"), ("fail", "no"), ("unknown", "can't tell")))
            + "</p>" for k, q in CHECKS.items())
        parts.append(f'<fieldset data-clip="{html.escape(c.clip_id)}"><legend>'
                     f'{html.escape(c.clip_id)}</legend><video controls preload="none" '
                     f'src="clips/{html.escape(name)}"></video>{qs}</fieldset>')
    (out / "index.html").write_text(PAGE.format(clips="\n".join(parts),
                                                checks=json.dumps(CHECKS)))
    return len(originals)


def load_labels(path: Path = LABELS) -> dict[str, dict[str, Any]]:
    """clip_id -> label record. Every record must say who labelled, when, and blind = true."""
    if not path.exists():
        return {}
    out = {}
    for n, line in enumerate(path.read_text().splitlines(), 1):
        if not line.strip():
            continue
        r = json.loads(line)
        missing = REQUIRED_KEYS - r.keys()
        if missing or r.get("blind") is not True:
            raise ValueError(f"{path}:{n}: label record must have {sorted(REQUIRED_KEYS)} "
                             f"and blind = true (missing {sorted(missing)})")
        out[r["clip_id"]] = r
    return out


def blind_slice(synthetic: Mapping[str, Any],
                labels: Mapping[str, Mapping[str, Any]]) -> dict[str, Any] | None:
    """The labelled originals of a synthetic-slice result, as their own slice (same engine
    results, independent labels instead of the assumed ones)."""
    clips = []
    for c in synthetic["clips"]:
        lab = labels.get(c["clip_id"])
        if lab is None or lab["truth"] not in ("accept", "reject"):
            continue
        clips.append({**c, "truth": lab["truth"], "checks": dict(lab["checks"]),
                      "labels_source": "human", "notes": f"blind label by {lab['labeller']}"})
    if not clips:
        return None
    ids = {c["clip_id"] for c in clips}
    return {"slice": "egocentric_blind", "rubric": synthetic["rubric"], "clips": clips,
            "engines": {e: {k: v for k, v in r.items() if k in ids}
                        for e, r in synthetic["engines"].items()},
            "spend": {"cap_usd": 0.0, "spent_usd": 0.0, "by_model": {}}, "stats": {}}


def main(argv: Sequence[str] | None = None) -> int:  # pragma: no cover
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--manifest", type=Path, required=True)
    ap.add_argument("--out", type=Path, required=True)
    a = ap.parse_args(argv)
    print(f"{build_kit(load_manifest(a.manifest), a.out)} clips in {a.out}")
    return 0


if __name__ == "__main__":  # pragma: no cover
    sys.exit(main())
