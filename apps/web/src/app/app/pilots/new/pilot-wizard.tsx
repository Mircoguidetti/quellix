"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { CircleCheck, CircleX, FileSpreadsheet, FolderOpen, LoaderCircle, Plus, Trash2, TriangleAlert, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, inputClass } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { matchFiles, parsePilotCsv, PILOT_CSV_COLUMNS, type CsvProblem, type PilotRow } from "@/lib/pilots/csv";
import { DEFAULT_CRITERIA, DEFAULT_REVIEW_MINUTES, METRICS, type Criterion, type MetricKey } from "@/lib/pilots/report";
import { putToSignedUrl } from "@/lib/storage-upload";
import { cn } from "@/lib/utils";
import { createPilotAction, finishPilotUploadAction, queueUrlItemsAction, startPilotUploadAction } from "../actions";

type Rubric = { id: string; name: string; versions: number };
type Draft = { key: number; choice: MetricKey | "lab"; op: "<=" | ">="; percent: string };
type Upload = { externalId: string; file: File; state: "waiting" | "uploading" | "queued" | "error"; progress: number; error?: string };

const TYPES: Record<string, string> = { mp4: "video/mp4", mov: "video/quicktime", webm: "video/webm" };
const TEMPLATE = `${PILOT_CSV_COLUMNS.join(",")}\nv_1001,accept,2.5,accept,c_42,\nv_1002,reject,4,reject,c_17,\n`;

function contentType(file: File): string | null {
  if (Object.values(TYPES).includes(file.type)) return file.type;
  return TYPES[file.name.split(".").pop()?.toLowerCase() ?? ""] ?? null;
}

function toDraft(c: Criterion, key: number): Draft {
  if (c.kind !== "threshold") return { key, choice: "lab", op: "<=", percent: "" };
  return { key, choice: c.metric, op: c.op, percent: String(Math.round(c.value * 1000) / 10) };
}

function toCriterion(d: Draft): Criterion | null {
  if (d.choice === "lab") return { kind: "false_accepts_vs_lab_not_above_reviewers" };
  const n = Number(d.percent);
  if (d.percent.trim() === "" || !Number.isFinite(n) || n < -100 || n > 100) return null;
  return { kind: "threshold", metric: d.choice, op: d.op, value: n / 100 };
}

export function PilotWizard({ rubrics }: { rubrics: Rubric[] }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [rubricId, setRubricId] = useState(rubrics[0]?.id ?? "");
  const versions = rubrics.find((r) => r.id === rubricId)?.versions ?? 1;
  const [version, setVersion] = useState(versions);
  const [minutes, setMinutes] = useState("");
  const [drafts, setDrafts] = useState<Draft[]>(() => DEFAULT_CRITERIA.map(toDraft));
  const [csvName, setCsvName] = useState<string | null>(null);
  const [rows, setRows] = useState<PilotRow[]>([]);
  const [problems, setProblems] = useState<CsvProblem[]>([]);
  const [files, setFiles] = useState<File[]>([]);
  const [uploads, setUploads] = useState<Upload[] | null>(null);
  const [phase, setPhase] = useState<"edit" | "creating" | "uploading" | "done">("edit");
  const [error, setError] = useState<string | null>(null);

  const { matched, unmatchedFiles } = useMemo(() => matchFiles(rows, files), [rows, files]);
  const urlRows = rows.filter((r) => r.source_url && !matched.has(r.external_id)).length;
  const missing = rows.filter((r) => !r.source_url && !matched.has(r.external_id));
  const criteria = drafts.map(toCriterion);
  const criteriaValid = criteria.length > 0 && criteria.every(Boolean);
  const runnable = matched.size + urlRows;
  const minutesValue = minutes.trim() === "" ? null : Number(minutes);
  const minutesValid = minutesValue === null || (Number.isFinite(minutesValue) && minutesValue > 0 && minutesValue <= 600);
  const ready = name.trim() !== "" && rubricId !== "" && criteriaValid && minutesValid && rows.length > 0 && problems.length === 0 && runnable > 0;

  async function onCsv(file: File | undefined) {
    if (!file) return;
    const parsed = parsePilotCsv(await file.text());
    setCsvName(file.name);
    setRows(parsed.rows);
    setProblems(parsed.problems);
  }

  const update = (key: number, patch: Partial<Draft>) => setDrafts((ds) => ds.map((d) => (d.key === key ? { ...d, ...patch } : d)));

  async function start() {
    setError(null);
    setPhase("creating");
    const created = await createPilotAction({
      name: name.trim(),
      rubric_id: rubricId,
      rubric_version: version,
      criteria: criteria.filter(Boolean),
      default_review_minutes: minutesValue,
      rows,
    });
    if (!created.ok) {
      setError(created.error);
      setPhase("edit");
      return;
    }
    const pilotId = created.id;
    const list: Upload[] = [...matched.entries()].map(([externalId, file]) => ({ externalId, file, state: "waiting", progress: 0 }));
    setUploads(list);
    setPhase("uploading");
    const set = (i: number, patch: Partial<Upload>) => setUploads((us) => us && us.map((u, j) => (j === i ? { ...u, ...patch } : u)));

    let next = 0;
    const worker = async () => {
      while (next < list.length) {
        const i = next++;
        const u = list[i];
        const type = contentType(u.file);
        if (!type) {
          set(i, { state: "error", error: "Not an MP4, MOV or WebM file" });
          continue;
        }
        set(i, { state: "uploading" });
        const begun = await startPilotUploadAction(pilotId, { external_id: u.externalId, filename: u.file.name, content_type: type, size_bytes: u.file.size });
        if (!begun.ok) {
          set(i, { state: "error", error: begun.error });
          continue;
        }
        try {
          await putToSignedUrl(begun.uploadUrl, u.file, (p) => set(i, { progress: p }));
          const done = await finishPilotUploadAction(pilotId, begun.videoId);
          set(i, done.ok ? { state: "queued", progress: 1 } : { state: "error", error: done.error });
        } catch (e) {
          set(i, { state: "error", error: e instanceof Error ? e.message : "Upload failed" });
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(3, list.length) }, worker));
    if (urlRows) {
      const queued = await queueUrlItemsAction(pilotId);
      if (!queued.ok) setError(queued.error);
    }
    setPhase("done");
    router.push(`/app/pilots/${pilotId}`);
  }

  if (uploads && phase !== "edit") {
    const done = uploads.filter((u) => u.state === "queued").length;
    return (
      <Card>
        <CardHeader>
          <CardTitle>Uploading to the pilot</CardTitle>
          <CardDescription>
            {done} of {uploads.length} videos queued{urlRows ? ` · ${urlRows} fetched from their URLs` : ""}. Keep this tab open until the uploads finish; the report opens on its own.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-2">
          {error && <p role="alert" className="text-[13.5px] text-reject-fg">{error}</p>}
          <ul aria-label="Uploads" className="grid gap-1.5">
            {uploads.map((u) => (
              <li key={u.externalId} className="flex items-center gap-3 text-[13.5px]">
                {u.state === "queued" ? (
                  <CircleCheck className="size-4 text-accept-fg" aria-label="Queued" />
                ) : u.state === "error" ? (
                  <CircleX className="size-4 text-reject-fg" aria-label="Failed" />
                ) : (
                  <LoaderCircle className="size-4 animate-spin text-muted-foreground" aria-label="Uploading" />
                )}
                <span className="font-mono">{u.externalId}</span>
                <span className="truncate text-muted-foreground">{u.error ?? (u.state === "uploading" ? `${Math.round(u.progress * 100)}%` : u.state)}</span>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    );
  }

  return (
    <form
      className="grid gap-6"
      aria-label="New pilot"
      onSubmit={(e) => {
        e.preventDefault();
        if (ready) void start();
      }}
    >
      <Card>
        <CardHeader>
          <CardTitle>1. The pilot</CardTitle>
          <CardDescription>Ormes runs every video against this rubric version, next to your reviewers, without touching your pipeline: no webhooks, nothing sent to contributors.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-1.5 sm:col-span-2">
            <Label htmlFor="pilot-name">Name</Label>
            <Input id="pilot-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Northwind kitchen tasks, October batch" maxLength={120} required />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="pilot-rubric">Rubric</Label>
            <select
              id="pilot-rubric"
              className={inputClass}
              value={rubricId}
              onChange={(e) => {
                setRubricId(e.target.value);
                setVersion(rubrics.find((r) => r.id === e.target.value)?.versions ?? 1);
              }}
            >
              {rubrics.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="pilot-version">Version</Label>
            <select id="pilot-version" className={inputClass} value={version} onChange={(e) => setVersion(Number(e.target.value))}>
              {Array.from({ length: versions }, (_, i) => versions - i).map((v) => (
                <option key={v} value={v}>
                  v{v}
                  {v === versions ? " (latest)" : ""}
                </option>
              ))}
            </select>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>2. Success criteria</CardTitle>
          <CardDescription>Agree these with the collector before the run. They are stored with the pilot and cannot be changed once it starts; the report says pass or fail against them.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">
          <ul className="grid gap-3" aria-label="Success criteria">
            {drafts.map((d, i) => {
              const valid = Boolean(criteria[i]);
              const isChange = d.choice !== "lab" && METRICS[d.choice].unit === "change";
              return (
                <li key={d.key} className="grid gap-2 rounded-lg border border-border p-3 sm:grid-cols-[1.6fr_0.6fr_0.7fr_auto] sm:items-end">
                  <div className="grid gap-1.5">
                    <Label htmlFor={`crit-${d.key}`}>Criterion {i + 1}</Label>
                    <select id={`crit-${d.key}`} className={inputClass} value={d.choice} onChange={(e) => update(d.key, { choice: e.target.value as Draft["choice"] })}>
                      {(Object.keys(METRICS) as MetricKey[]).map((m) => (
                        <option key={m} value={m}>
                          {METRICS[m].label}
                        </option>
                      ))}
                      <option value="lab">False accepts vs lab: not above your reviewers</option>
                    </select>
                  </div>
                  {d.choice === "lab" ? (
                    <p className="text-[12.5px] text-muted-foreground sm:col-span-2">Needs a lab_outcome column with some rejections.</p>
                  ) : (
                    <>
                      <div className="grid gap-1.5">
                        <Label htmlFor={`op-${d.key}`}>Must be</Label>
                        <select id={`op-${d.key}`} className={inputClass} value={d.op} onChange={(e) => update(d.key, { op: e.target.value as Draft["op"] })}>
                          <option value="<=">at most</option>
                          <option value=">=">at least</option>
                        </select>
                      </div>
                      <div className="grid gap-1.5">
                        <Label htmlFor={`val-${d.key}`}>{isChange ? "Change (%)" : "Percent"}</Label>
                        <Input
                          id={`val-${d.key}`}
                          inputMode="decimal"
                          value={d.percent}
                          onChange={(e) => update(d.key, { percent: e.target.value })}
                          aria-invalid={!valid}
                          aria-describedby={`help-${d.key}`}
                        />
                      </div>
                    </>
                  )}
                  <Button type="button" variant="ghost" size="icon" aria-label={`Remove criterion ${i + 1}`} disabled={drafts.length === 1} onClick={() => setDrafts((ds) => ds.filter((x) => x.key !== d.key))}>
                    <Trash2 aria-hidden />
                  </Button>
                  <p id={`help-${d.key}`} className="text-[12.5px] text-muted-foreground sm:col-span-4">
                    {d.choice === "lab"
                      ? "With Ormes deciding, and your reviewers resolving what it sends to review, false accepts against the lab's outcome are no higher than your reviewers' today."
                      : `${METRICS[d.choice].help}${isChange ? " Use a negative number for a reduction, e.g. −40." : ""}`}
                  </p>
                </li>
              );
            })}
          </ul>
          <div className="flex flex-wrap items-end justify-between gap-3">
            <Button
              type="button"
              variant="secondary"
              disabled={drafts.length >= 8}
              onClick={() => setDrafts((ds) => [...ds, { key: Math.max(0, ...ds.map((x) => x.key)) + 1, choice: "false_reject_rate", op: "<=", percent: "5" }])}
            >
              <Plus aria-hidden />
              Add criterion
            </Button>
            <div className="grid gap-1.5">
              <Label htmlFor="pilot-minutes">Review minutes per video, when the CSV has none</Label>
              <Input
                id="pilot-minutes"
                inputMode="decimal"
                placeholder={`Average of the CSV, else ${DEFAULT_REVIEW_MINUTES}`}
                value={minutes}
                onChange={(e) => setMinutes(e.target.value)}
                aria-invalid={!minutesValid}
                className="w-full sm:w-72"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>3. Your reviewers&rsquo; decisions</CardTitle>
          <CardDescription>
            A CSV with <code className="font-mono text-[12.5px]">external_id, reviewer_decision</code> and optionally <code className="font-mono text-[12.5px]">reviewer_minutes, lab_outcome, contributor_ref, source_url</code>.{" "}
            <a className="underline underline-offset-2" href={`data:text/csv;charset=utf-8,${encodeURIComponent(TEMPLATE)}`} download="ormes-pilot-template.csv">
              Download a template
            </a>
            .
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">
          <label className="flex cursor-pointer flex-wrap items-center gap-3 rounded-lg border border-dashed border-border p-4 hover:bg-subtle focus-within:ring-2 focus-within:ring-ring">
            <FileSpreadsheet className="size-5 text-muted-foreground" aria-hidden />
            <span className="text-[14px]">{csvName ? `${csvName}: ${rows.length} rows` : "Choose the CSV"}</span>
            <input type="file" accept=".csv,text/csv" className="sr-only" aria-label="Reviewers' decisions CSV" onChange={(e) => void onCsv(e.target.files?.[0])} />
          </label>
          {rows.length > 0 && (
            <p className="text-[13.5px] text-muted-foreground">
              {rows.filter((r) => r.reviewer_decision === "accept").length} accepted, {rows.filter((r) => r.reviewer_decision === "reject").length} rejected by your reviewers ·{" "}
              {rows.filter((r) => r.lab_outcome).length} with a lab outcome · {rows.filter((r) => r.source_url).length} with a URL
            </p>
          )}
          {problems.length > 0 && (
            <div role="alert" className="grid gap-1 rounded-lg border border-border bg-subtle p-3 text-[13.5px]">
              <p className="flex items-center gap-2 font-medium">
                <TriangleAlert className="size-4 text-reject-fg" aria-hidden />
                Fix the CSV and choose it again ({problems.length} problem{problems.length === 1 ? "" : "s"})
              </p>
              <ul className="grid gap-0.5 pl-6">
                {problems.slice(0, 8).map((p, i) => (
                  <li key={i}>
                    Line {p.line}: {p.message}
                  </li>
                ))}
                {problems.length > 8 && <li>…and {problems.length - 8} more.</li>}
              </ul>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>4. The videos</CardTitle>
          <CardDescription>
            Choose the folder (or the files). Each file is matched to the CSV row whose external_id is its file name, with or without the extension. Rows with a source_url need no file: Ormes fetches it. Files go straight
            to encrypted storage and are deleted after analysis.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">
          <div className="flex flex-wrap gap-2">
            <label className={cn("inline-flex h-9 cursor-pointer items-center gap-2 rounded-lg border border-border px-3 text-sm font-medium hover:bg-subtle focus-within:ring-2 focus-within:ring-ring")}>
              <FolderOpen className="size-4" aria-hidden />
              Choose a folder
              <input
                type="file"
                multiple
                className="sr-only"
                aria-label="Folder of videos"
                {...{ webkitdirectory: "" }}
                onChange={(e) => setFiles(Array.from(e.target.files ?? []).filter((f) => contentType(f)))}
              />
            </label>
            <label className="inline-flex h-9 cursor-pointer items-center gap-2 rounded-lg border border-border px-3 text-sm font-medium hover:bg-subtle focus-within:ring-2 focus-within:ring-ring">
              <Upload className="size-4" aria-hidden />
              Choose files
              <input type="file" multiple accept="video/mp4,video/quicktime,video/webm,.mp4,.mov,.webm" className="sr-only" aria-label="Video files" onChange={(e) => setFiles(Array.from(e.target.files ?? []))} />
            </label>
          </div>
          {rows.length > 0 && (
            <ul className="grid gap-1 text-[13.5px]" aria-label="Matching">
              <li>
                <strong className="font-medium">{matched.size}</strong> of {rows.length} rows matched to a file
                {urlRows ? (
                  <>
                    , <strong className="font-medium">{urlRows}</strong> fetched from their URL
                  </>
                ) : null}
                .
              </li>
              {missing.length > 0 && (
                <li className="text-muted-foreground">
                  {missing.length} row{missing.length === 1 ? "" : "s"} without a file or URL (shown as missing in the report): {missing.slice(0, 5).map((r) => r.external_id).join(", ")}
                  {missing.length > 5 ? "…" : ""}
                </li>
              )}
              {unmatchedFiles.length > 0 && (
                <li className="text-muted-foreground">
                  {unmatchedFiles.length} file{unmatchedFiles.length === 1 ? "" : "s"} not in the CSV (ignored): {unmatchedFiles.slice(0, 5).map((f) => f.name).join(", ")}
                  {unmatchedFiles.length > 5 ? "…" : ""}
                </li>
              )}
            </ul>
          )}
        </CardContent>
      </Card>

      {error && (
        <p role="alert" className="text-[14px] text-reject-fg">
          {error}
        </p>
      )}
      <div className="flex flex-wrap items-center justify-end gap-3">
        {!ready && <p className="text-[13px] text-muted-foreground">Name the pilot, keep the criteria valid and add a CSV with at least one video to run.</p>}
        <Button type="submit" disabled={!ready || phase !== "edit"}>
          {phase === "creating" && <LoaderCircle className="animate-spin" aria-hidden />}
          Start the pilot ({runnable} video{runnable === 1 ? "" : "s"})
        </Button>
      </div>
    </form>
  );
}
