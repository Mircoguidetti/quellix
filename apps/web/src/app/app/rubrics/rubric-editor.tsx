"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { validateRubric } from "@/lib/rubric";
import { saveRubric } from "./actions";
import { button, card, input, muted } from "@/components/ui";

type Json = Record<string, unknown>;
type Value = string | number | boolean | undefined;
type Field =
  | { key: string; label: string; kind: "number"; min?: number; max?: number; step?: number }
  | { key: string; label: string; kind: "bool" }
  | { key: string; label: string; kind: "select"; options: string[] };

const RATIO = { min: 0, max: 1, step: 0.01 } as const;
const HANDLING = ["reject", "review", "ignore"];

const CHECKS: { name: string; title: string; help: string; critical: boolean; fields: Field[] }[] = [
  {
    name: "task_completed",
    title: "Task completed",
    help: "Did the contributor finish the task described above?",
    critical: true,
    fields: [{ key: "min_confidence", label: "Minimum confidence", kind: "number", ...RATIO }],
  },
  {
    name: "hands_visible",
    title: "Hands visible",
    help: "Hands must stay in view.",
    critical: true,
    fields: [
      { key: "scope", label: "Scope", kind: "select", options: ["manipulation", "whole_video"] },
      { key: "require_both", label: "Both hands required", kind: "bool" },
      { key: "min_ratio", label: "Minimum visible ratio", kind: "number", ...RATIO },
    ],
  },
  {
    name: "framing",
    title: "Framing and stability",
    help: "Camera pointed at the work, steady.",
    critical: true,
    fields: [
      { key: "max_off_target_ratio", label: "Max off-target ratio", kind: "number", ...RATIO },
      { key: "max_unstable_ratio", label: "Max unstable ratio", kind: "number", ...RATIO },
    ],
  },
  {
    name: "technical",
    title: "Technical quality",
    help: "Duration, resolution, frame rate, blur and exposure.",
    critical: true,
    fields: [
      { key: "min_duration_s", label: "Min duration (s)", kind: "number", min: 0 },
      { key: "max_duration_s", label: "Max duration (s)", kind: "number", min: 0 },
      { key: "min_width", label: "Min width (px)", kind: "number", min: 1, step: 1 },
      { key: "min_height", label: "Min height (px)", kind: "number", min: 1, step: 1 },
      { key: "min_fps", label: "Min frames per second", kind: "number", min: 1 },
      { key: "max_blur_ratio", label: "Max blur ratio", kind: "number", ...RATIO },
      { key: "max_bad_exposure_ratio", label: "Max bad-exposure ratio", kind: "number", ...RATIO },
    ],
  },
  {
    name: "privacy",
    title: "Privacy",
    help: "What to do when faces, documents or screens appear.",
    critical: false,
    fields: [
      { key: "faces", label: "Faces", kind: "select", options: HANDLING },
      { key: "documents", label: "Documents", kind: "select", options: HANDLING },
      { key: "screens", label: "Screens", kind: "select", options: HANDLING },
    ],
  },
  {
    name: "originality",
    title: "Originality",
    help: "Duplicates of earlier videos from your organization.",
    critical: false,
    fields: [
      { key: "similarity_threshold", label: "Similarity threshold", kind: "number", ...RATIO },
      { key: "on_duplicate", label: "On duplicate", kind: "select", options: ["reject", "review"] },
    ],
  },
];

export function RubricEditor({
  rubricId = null,
  initial,
}: {
  rubricId?: string | null;
  initial: { name: string; task: Json; checks: Json };
}) {
  const router = useRouter();
  const [name, setName] = useState(initial.name);
  const [task, setTask] = useState<Json>(initial.task);
  const [checks, setChecks] = useState<Json>(initial.checks);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const body = useMemo(() => ({ name, task, checks }), [name, task, checks]);
  const problems = useMemo(() => validateRubric({ id: "preview", version: 1, ...body }), [body]);

  const setTaskField = (key: string, value: string | string[]) =>
    setTask((t) => {
      const next = { ...t };
      if (value === "" || (Array.isArray(value) && value.length === 0)) delete next[key];
      else next[key] = value;
      return next;
    });

  const setCheckField = (check: string, key: string, value: Value) =>
    setChecks((c) => {
      const current = { ...((c[check] as Json | undefined) ?? {}) };
      if (value === undefined || value === "") delete current[key];
      else current[key] = value;
      return { ...c, [check]: current };
    });

  async function save() {
    setSaving(true);
    setError(null);
    const res = await saveRubric(rubricId, body);
    setSaving(false);
    if (!res.ok) return setError(res.error);
    router.push(`/app/rubrics/${res.id}`);
    router.refresh();
  }

  const steps = Array.isArray(task.steps) ? (task.steps as string[]) : [];

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
      <div className="flex flex-col gap-4">
        <section className={card + " flex flex-col gap-3"}>
          <label className="flex flex-col gap-1 text-sm">
            Name
            <input className={input} value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Task description
            <textarea
              className={input}
              rows={2}
              value={(task.description as string) ?? ""}
              onChange={(e) => setTask((t) => ({ ...t, description: e.target.value }))}
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Task library id (optional, e.g. load_dishwasher)
            <input
              className={input}
              value={(task.library_id as string) ?? ""}
              onChange={(e) => setTaskField("library_id", e.target.value)}
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Steps (one per line)
            <textarea
              className={input}
              rows={3}
              value={steps.join("\n")}
              onChange={(e) => setTaskField("steps", e.target.value.split("\n"))}
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Final state (optional)
            <input
              className={input}
              value={(task.final_state as string) ?? ""}
              onChange={(e) => setTaskField("final_state", e.target.value)}
            />
          </label>
        </section>

        {CHECKS.map((spec) => {
          const c = (checks[spec.name] as Json | undefined) ?? {};
          const enabled = c.enabled !== false;
          return (
            <section key={spec.name} className={card + " flex flex-col gap-3"}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h2 className="font-medium">{spec.title}</h2>
                  <p className={"text-xs " + muted}>{spec.help}</p>
                </div>
                <div className="flex gap-4 text-sm">
                  <label className="flex items-center gap-1">
                    <input type="checkbox" checked={enabled} onChange={(e) => setCheckField(spec.name, "enabled", e.target.checked)} />
                    Enabled
                  </label>
                  {spec.critical && (
                    <label className="flex items-center gap-1" title="A failed critical check rejects the video">
                      <input
                        type="checkbox"
                        checked={c.critical !== undefined ? c.critical === true : spec.name !== "framing"}
                        onChange={(e) => setCheckField(spec.name, "critical", e.target.checked)}
                      />
                      Critical
                    </label>
                  )}
                </div>
              </div>
              {enabled && (
                <div className="grid gap-3 sm:grid-cols-2">
                  {spec.fields.map((f) => (
                    <FieldInput key={f.key} field={f} value={c[f.key] as Value} onChange={(v) => setCheckField(spec.name, f.key, v)} />
                  ))}
                </div>
              )}
            </section>
          );
        })}
      </div>

      <aside className="flex flex-col gap-3 lg:sticky lg:top-4 lg:self-start">
        <div className={card}>
          <h2 className="mb-2 font-medium">Validation</h2>
          {problems.length === 0 ? (
            <p className="text-sm text-emerald-700 dark:text-emerald-400">Valid against the rubric schema.</p>
          ) : (
            <ul className="list-disc pl-5 text-sm text-red-600 dark:text-red-400">
              {problems.map((p, i) => (
                <li key={i}>{p}</li>
              ))}
            </ul>
          )}
        </div>
        <button className={button("primary")} disabled={saving || problems.length > 0} onClick={save}>
          {saving ? "Saving…" : rubricId ? "Save as new version" : "Create rubric"}
        </button>
        {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
        <details className={card} open>
          <summary className="cursor-pointer font-medium">JSON preview</summary>
          <pre className="mt-2 max-h-96 overflow-auto text-xs">{JSON.stringify(body, null, 2)}</pre>
        </details>
      </aside>
    </div>
  );
}

function FieldInput({ field, value, onChange }: { field: Field; value: Value; onChange: (v: Value) => void }) {
  if (field.kind === "bool") {
    return (
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={value === undefined ? true : value === true} onChange={(e) => onChange(e.target.checked)} />
        {field.label}
      </label>
    );
  }
  if (field.kind === "select") {
    return (
      <label className="flex flex-col gap-1 text-sm">
        {field.label}
        <select className={input} value={(value as string) ?? ""} onChange={(e) => onChange(e.target.value || undefined)}>
          <option value="">Default</option>
          {field.options.map((o) => (
            <option key={o}>{o}</option>
          ))}
        </select>
      </label>
    );
  }
  return (
    <label className="flex flex-col gap-1 text-sm">
      {field.label}
      <input
        type="number"
        className={input}
        min={field.min}
        max={field.max}
        step={field.step ?? "any"}
        placeholder="Default"
        value={value === undefined ? "" : String(value)}
        onChange={(e) => onChange(e.target.value === "" ? undefined : Number(e.target.value))}
      />
    </label>
  );
}
