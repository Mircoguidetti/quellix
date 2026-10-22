"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input, inputClass } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export type RubricOption = { id: string; name: string; versions: number };

/** A plain GET form: the page reads the same query string the export link sends. */
export function AuditFilters({
  rubrics,
  value,
}: {
  rubrics: RubricOption[];
  value: { from: string; to: string; rubric_id?: string; version?: number };
}) {
  const [rubric, setRubric] = useState(value.rubric_id ?? "");
  const versions = rubrics.find((r) => r.id === rubric)?.versions ?? 0;

  return (
    <form method="get" action="/app/audit" aria-label="Audit filters" className="grid gap-3 rounded-xl border border-border p-4 sm:grid-cols-2 lg:grid-cols-[1.4fr_0.8fr_1fr_1fr_auto] lg:items-end">
      <div className="grid gap-1.5">
        <Label htmlFor="audit-rubric">Rubric</Label>
        <select id="audit-rubric" name="rubric_id" value={rubric} onChange={(e) => setRubric(e.target.value)} className={inputClass}>
          <option value="">All rubrics</option>
          {rubrics.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </select>
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="audit-version">Version</Label>
        <select
          id="audit-version"
          name="version"
          key={rubric}
          defaultValue={rubric === value.rubric_id && value.version ? String(value.version) : ""}
          disabled={!rubric}
          className={inputClass}
        >
          <option value="">All versions</option>
          {Array.from({ length: versions }, (_, i) => versions - i).map((v) => (
            <option key={v} value={v}>
              v{v}
            </option>
          ))}
        </select>
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="audit-from">Received from</Label>
        <Input id="audit-from" name="from" type="date" defaultValue={value.from} required />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="audit-to">Received to</Label>
        <Input id="audit-to" name="to" type="date" defaultValue={value.to} required />
      </div>
      <Button type="submit" className="sm:col-span-2 lg:col-span-1">
        Apply
      </Button>
    </form>
  );
}
