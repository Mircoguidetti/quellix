# models/tasks

The task library: models that decide whether a known task was completed (steps happened, final state reached), better than a general model.

Starts after `eval` has baseline numbers from Gemini and TwelveLabs on the same clips. Until then, `task_completed` uses the general-model baseline as a fallback, and this folder only holds the plan.

## Plan

- Library of the 10-20 tasks collectors record most (load dishwasher, fold clothes, set table, wipe counter, ...), each with steps and a final state.
- Per task family: temporal model over frame features that detects the steps and the final state; outputs the worker's `task_completed` measurements (`completed`, `confidence`, `start_s`, `end_s`, `steps`).
- General models are used as a teacher to bootstrap labels, corrected by humans, and as the fallback for tasks not yet in the library.
- Ship a task only when it beats the best general model on rejection precision at equal recall, measured in `eval`.
