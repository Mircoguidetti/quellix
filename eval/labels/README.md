# Independent labels

Labels here were made by people **without seeing any Ormes output** (no decision, measurement or
model name). They are the truth for benchmark slices that have no public annotations.

`egocentric10k-blind-v1.jsonl`: one JSON object per line, exported by the blind labelling kit
(`python -m quellix_eval.benchmark.kit`, also an artifact of every benchmark run):

```json
{"clip_id": "...", "checks": {"hands_visible": "pass|fail|unknown", "technical": "...",
 "privacy": "...", "framing": "..."}, "truth": "accept|reject|unknown",
 "labeller": "Full name", "labelled_at": "ISO date", "blind": true}
```

Rules: the labeller must not have seen Ormes's result for these clips; one labeller per file
version; never edit a committed label after a run has used it (add a new version instead).
