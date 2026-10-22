"use client";

import { useRef, useState, useTransition } from "react";
import Link from "next/link";
import { CircleAlert, FileText, Quote, RotateCcw, Sparkles, Upload } from "lucide-react";
import { FormAlert } from "@/components/auth/form-alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import type { SpecDraft } from "@/lib/spec-import/types";
import { RubricEditor } from "../rubric-editor";
import { importSpec } from "./actions";

type EditorProps = React.ComponentProps<typeof RubricEditor>;

const LABELS: Record<string, string> = {
  "task.description": "Task description",
  "task.steps": "Task steps",
  "task.final_state": "Final state",
  "checks.task_completed.enabled": "Task completion check",
  "checks.hands_visible.enabled": "Hands check",
  "checks.hands_visible.scope": "Hands: scope",
  "checks.hands_visible.require_both": "Hands: both required",
  "checks.hands_visible.min_ratio": "Hands: minimum visible",
  "checks.framing.enabled": "Framing check",
  "checks.framing.max_off_target_ratio": "Framing: max off target",
  "checks.framing.max_unstable_ratio": "Framing: max unstable",
  "checks.technical.min_duration_s": "Minimum duration",
  "checks.technical.max_duration_s": "Maximum duration",
  "checks.technical.min_width": "Minimum width",
  "checks.technical.min_height": "Minimum height",
  "checks.technical.min_fps": "Minimum frame rate",
  "checks.technical.max_blur_ratio": "Max blurry frames",
  "checks.technical.max_bad_exposure_ratio": "Max badly exposed frames",
  "checks.privacy.faces": "Faces",
  "checks.privacy.documents": "Documents",
  "checks.privacy.screens": "Screens",
  "checks.originality.on_duplicate": "Duplicates",
};

function show(path: string, value: unknown): string {
  if (Array.isArray(value)) return `${value.length} steps`;
  if (typeof value === "boolean") return value ? "yes" : "no";
  if (typeof value === "number") {
    if (/ratio/.test(path)) return `${Math.round(value * 1000) / 10}%`;
    if (/duration_s/.test(path)) return value >= 60 && value % 60 === 0 ? `${value / 60} min` : `${value} s`;
    if (/fps/.test(path)) return `${value} fps`;
    if (/width|height/.test(path)) return `${value} px`;
  }
  return String(value);
}

async function readFile(file: File): Promise<string> {
  if (file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")) {
    // Parsed in the browser: the PDF itself is never uploaded, only the text you then submit.
    const { extractText, getDocumentProxy } = await import("unpdf");
    const pdf = await getDocumentProxy(new Uint8Array(await file.arrayBuffer()));
    const { text } = await extractText(pdf, { mergePages: true });
    return text;
  }
  return file.text();
}

export function SpecImporter({
  model,
  samples,
  sampleScope,
  canEdit,
}: {
  model: "available" | "disabled" | "unavailable";
  samples: EditorProps["samples"];
  sampleScope: EditorProps["sampleScope"];
  canEdit: boolean;
}) {
  const [text, setText] = useState("");
  const [useModel, setUseModel] = useState(false);
  const [draft, setDraft] = useState<SpecDraft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const [pending, start] = useTransition();
  const fileInput = useRef<HTMLInputElement>(null);

  if (!canEdit) return <FormAlert tone="info">Only owners and admins can create rubrics.</FormAlert>;

  async function onFile(file: File | undefined) {
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) return setError("That file is larger than 5 MB. Paste the relevant sections instead.");
    setError(null);
    setReading(true);
    try {
      setText((await readFile(file)).trim());
    } catch {
      setError("We could not read that file. Copy the text and paste it instead.");
    } finally {
      setReading(false);
    }
  }

  function submit() {
    setError(null);
    start(async () => {
      const res = await importSpec({ text, useModel: model === "available" && useModel });
      if (res.ok) setDraft(res.draft);
      else setError(res.error);
    });
  }

  if (draft) {
    return (
      <div className="grid gap-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-[14px] text-muted-foreground">
            Draft from {draft.fields.length} cited value{draft.fields.length === 1 ? "" : "s"}
            {draft.usedModel ? ", checked against the source" : ", local rules only"}. Unset fields keep their defaults. Review everything before saving.
          </p>
          <Button variant="secondary" size="sm" onClick={() => setDraft(null)}>
            <RotateCcw aria-hidden />
            Start over
          </Button>
        </div>
        <SourcePanel draft={draft} />
        <RubricEditor
          rubricId={null}
          currentVersion={null}
          initial={draft.rubric}
          history={[]}
          samples={samples}
          sampleScope={sampleScope}
          canEdit
        />
      </div>
    );
  }

  return (
    <Card className="grid gap-4 p-5">
      <div className="grid gap-2">
        <Label htmlFor="spec-text">The lab&apos;s guidelines</Label>
        <Textarea
          id="spec-text"
          rows={14}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={"Paste the spec here, for example:\nBoth hands must be visible at least 90% of the time while manipulating objects.\nMinimum 1920x1080 at 30 fps. Videos must be at least 2 minutes long."}
        />
        <div className="flex flex-wrap items-center gap-3 text-[13px] text-muted-foreground">
          <Button type="button" variant="secondary" size="sm" loading={reading} onClick={() => fileInput.current?.click()}>
            <Upload aria-hidden />
            Read a PDF or text file
          </Button>
          <span>PDFs are read in your browser; the file is not uploaded.</span>
          <input
            ref={fileInput}
            type="file"
            aria-label="Spec file (PDF or text)"
            accept=".pdf,.txt,.md,application/pdf,text/plain,text/markdown"
            className="hidden"
            onChange={(e) => onFile(e.target.files?.[0])}
          />
        </div>
      </div>

      <div className="flex items-start gap-3 rounded-lg border border-border p-3">
        <Switch id="use-model" checked={model === "available" && useModel} onCheckedChange={setUseModel} disabled={model !== "available"} />
        <div className="grid gap-0.5">
          <Label htmlFor="use-model" className="flex items-center gap-1.5">
            <Sparkles className="size-3.5" aria-hidden />
            Also ask Gemini to read the spec
          </Label>
          <p className="text-[13px] text-muted-foreground">
            {model === "available" &&
              "Sends this text to Google Gemini. Every value it suggests is checked against the line it cites; anything that does not match is dropped. Off: only our local rules run and the text stays with us."}
            {model === "disabled" && (
              <>
                Off for your organization: the text stays with us and only our local rules run. An owner or admin can allow third-party models in{" "}
                <Link href="/app/settings" className="underline underline-offset-2">
                  Settings
                </Link>
                .
              </>
            )}
            {model === "unavailable" && "Not available on this deployment. Only our local rules run; the text stays with us."}
          </p>
        </div>
      </div>

      {error && <FormAlert>{error}</FormAlert>}
      <div>
        <Button onClick={submit} loading={pending} disabled={text.trim().length < 20}>
          <FileText aria-hidden />
          Draft the rubric
        </Button>
      </div>
    </Card>
  );
}

function SourcePanel({ draft }: { draft: SpecDraft }) {
  return (
    <Card className="grid gap-4 p-5">
      <section aria-labelledby="cited" className="grid gap-2">
        <h2 id="cited" className="flex items-center gap-2 font-mono text-[11.5px] uppercase tracking-[0.08em] text-muted-foreground">
          <Quote className="size-3.5" aria-hidden />
          Where each value comes from
        </h2>
        {draft.fields.length === 0 ? (
          <p className="text-[14px] text-muted-foreground">Nothing in the text maps to a rubric field. The editor starts from the defaults.</p>
        ) : (
          <ul className="divide-y divide-border rounded-lg border border-border">
            {draft.fields.map((f) => (
              <li key={f.path} className="grid gap-1 px-3 py-2 text-[13.5px] sm:grid-cols-[13rem_7rem_1fr] sm:items-baseline sm:gap-3">
                <span className="font-medium">{LABELS[f.path] ?? f.path}</span>
                <span className="font-mono text-[12.5px] tabular-nums">{show(f.path, f.value)}</span>
                <span className="text-muted-foreground">
                  <span className="mr-1.5 font-mono text-[12px] text-foreground/80">line {f.line}</span>“{f.quote}”
                  {f.source === "model" && (
                    <Badge tone="outline" className="ml-2">
                      Gemini, verified
                    </Badge>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {draft.unsupported.length > 0 && (
        <section aria-labelledby="unsupported" className="grid gap-2">
          <h2 id="unsupported" className="flex items-center gap-2 font-mono text-[11.5px] uppercase tracking-[0.08em] text-muted-foreground">
            <CircleAlert className="size-3.5" aria-hidden />
            In the spec but not checked by Ormes
          </h2>
          <ul className="grid gap-1.5 text-[13.5px]">
            {draft.unsupported.map((u, i) => (
              <li key={`${u.line}-${i}`}>
                <span className="mr-1.5 font-mono text-[12px] text-foreground/80">line {u.line}</span>
                {u.note} <span className="text-muted-foreground">“{u.quote}”</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {draft.warnings.length > 0 && (
        <section aria-labelledby="warnings" className="grid gap-1.5">
          <h2 id="warnings" className="font-mono text-[11.5px] uppercase tracking-[0.08em] text-muted-foreground">
            To check
          </h2>
          <ul className="grid list-disc gap-1 pl-5 text-[13.5px]">
            {draft.warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </section>
      )}
    </Card>
  );
}
