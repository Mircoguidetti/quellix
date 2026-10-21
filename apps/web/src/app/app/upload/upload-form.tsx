"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { CircleCheck, CircleX, FileVideo, LoaderCircle, Upload, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { finishUpload, startUpload } from "./actions";

type Rubric = { id: string; name: string; version: number };
type Item = { key: string; file: File; state: "waiting" | "uploading" | "queued" | "error"; progress: number; error?: string; videoId?: string };

const TYPES = ["video/mp4", "video/quicktime", "video/webm"];
const MAX_BYTES = 5 * 1024 ** 3;

function put(url: string, file: File, onProgress: (p: number) => void): Promise<void> {
  // Same wire format as supabase-js uploadToSignedUrl: PUT multipart straight to Storage.
  return new Promise((resolve, reject) => {
    const body = new FormData();
    body.append("cacheControl", "3600");
    body.append("", file);
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.setRequestHeader("x-upsert", "false");
    xhr.timeout = 30 * 60 * 1000;
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
    xhr.onload = () => (xhr.status < 300 ? resolve() : reject(new Error("The storage service refused the file. Try again.")));
    xhr.onerror = () => reject(new Error("The connection dropped during the upload."));
    xhr.ontimeout = () => reject(new Error("The upload took too long."));
    xhr.send(body);
  });
}

function size(bytes: number) {
  return bytes > 1e9 ? `${(bytes / 1e9).toFixed(1)} GB` : `${Math.max(1, Math.round(bytes / 1e6))} MB`;
}

export function UploadForm({ rubrics }: { rubrics: Rubric[] }) {
  const [rubricId, setRubricId] = useState(rubrics[0].id);
  const [lab, setLab] = useState<"unknown" | "accept" | "reject">("unknown");
  const [items, setItems] = useState<Item[]>([]);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const picker = useRef<HTMLInputElement>(null);

  const update = (key: string, patch: Partial<Item>) => setItems((list) => list.map((it) => (it.key === key ? { ...it, ...patch } : it)));

  function addFiles(files: FileList | File[]) {
    const all = [...files];
    const ok = all.filter((f) => TYPES.includes(f.type) && f.size <= MAX_BYTES);
    if (ok.length < all.length) toast.error(`${all.length - ok.length} file(s) skipped: only MP4, MOV or WebM up to 5 GB.`);
    setItems((list) => [...list, ...ok.map((file) => ({ key: `${file.name}-${file.size}-${Math.random()}`, file, state: "waiting" as const, progress: 0 }))]);
  }

  async function run() {
    setBusy(true);
    let queued = 0;
    for (const it of items) {
      if (it.state !== "waiting") continue;
      update(it.key, { state: "uploading" });
      const start = await startUpload({
        rubric_id: rubricId,
        filename: it.file.name,
        content_type: it.file.type,
        size_bytes: it.file.size,
        ...(lab !== "unknown" ? { lab_outcome: { outcome: lab } } : {}),
      }).catch(() => ({ ok: false as const, error: "We could not reach Quellix." }));
      if (!start.ok) {
        update(it.key, { state: "error", error: start.error });
        continue;
      }
      try {
        await put(start.uploadUrl, it.file, (p) => update(it.key, { progress: p }));
        const done = await finishUpload(start.videoId);
        if (!done.ok) throw new Error(done.error);
        update(it.key, { state: "queued", progress: 1, videoId: start.videoId });
        queued++;
      } catch (e) {
        update(it.key, { state: "error", error: e instanceof Error ? e.message : "The upload failed.", videoId: start.videoId });
      }
    }
    setBusy(false);
    if (queued) toast.success(`${queued} video${queued > 1 ? "s" : ""} queued for analysis`, { description: "Decisions appear in Videos within a minute." });
  }

  const waiting = items.filter((i) => i.state === "waiting").length;

  return (
    <div className="grid gap-5">
      <Card className="grid gap-4 p-5 sm:grid-cols-2">
        <div className="grid gap-2">
          <Label htmlFor="upload-rubric">Rubric</Label>
          <Select value={rubricId} onValueChange={setRubricId} disabled={busy}>
            <SelectTrigger id="upload-rubric">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {rubrics.map((r) => (
                <SelectItem key={r.id} value={r.id}>
                  {r.name} <span className="font-mono text-muted-foreground">v{r.version}</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-2">
          <Label htmlFor="upload-lab">Lab outcome, if known</Label>
          <Select value={lab} onValueChange={(v) => setLab(v as typeof lab)} disabled={busy}>
            <SelectTrigger id="upload-lab">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="unknown">Not known yet</SelectItem>
              <SelectItem value="accept">The lab accepted these</SelectItem>
              <SelectItem value="reject">The lab rejected these</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </Card>

      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          addFiles(e.dataTransfer.files);
        }}
        className={cn(
          "flex flex-col items-center gap-3 rounded-xl border border-dashed border-input px-6 py-12 text-center transition-colors",
          dragging && "border-ring bg-accent",
        )}
      >
        <span className="grid size-11 place-items-center rounded-xl border border-border bg-subtle text-muted-foreground">
          <Upload className="size-5" aria-hidden />
        </span>
        <div>
          <p className="text-[15px] font-medium">Drop videos here</p>
          <p className="text-[13.5px] text-muted-foreground">MP4, MOV or WebM, up to 5 GB each</p>
        </div>
        <Button type="button" variant="secondary" onClick={() => picker.current?.click()} disabled={busy}>
          Choose files
        </Button>
        <input ref={picker} type="file" multiple accept={TYPES.join(",")} className="sr-only" tabIndex={-1} aria-hidden onChange={(e) => e.target.files && addFiles(e.target.files)} />
      </div>

      {items.length > 0 && (
        <ul className="divide-y divide-border rounded-xl border border-border" aria-label="Files">
          {items.map((it) => (
            <li key={it.key} className="grid gap-2 px-4 py-3">
              <div className="flex items-center gap-3">
                <FileVideo className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                <span className="min-w-0 flex-1 truncate text-[14px]">{it.file.name}</span>
                <span className="font-mono text-[12px] text-muted-foreground">{size(it.file.size)}</span>
                {it.state === "waiting" && (
                  <Button variant="ghost" size="icon-sm" aria-label={`Remove ${it.file.name}`} onClick={() => setItems((l) => l.filter((x) => x.key !== it.key))} disabled={busy}>
                    <X aria-hidden />
                  </Button>
                )}
                {it.state === "uploading" && <LoaderCircle className="size-4 animate-spin text-muted-foreground" aria-label="Uploading" />}
                {it.state === "queued" && (
                  <Link href={`/app/videos/${it.videoId}`} className="inline-flex items-center gap-1 rounded text-[13px] text-accept-fg hover:underline">
                    <CircleCheck className="size-4" aria-hidden />
                    Queued
                  </Link>
                )}
                {it.state === "error" && <CircleX className="size-4 text-reject-fg" aria-label="Failed" />}
              </div>
              {it.state === "uploading" && (
                <div className="h-1.5 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={Math.round(it.progress * 100)} aria-valuemin={0} aria-valuemax={100} aria-label={`Uploading ${it.file.name}`}>
                  <div className="h-full rounded-full bg-primary transition-[width]" style={{ width: `${Math.max(2, it.progress * 100)}%` }} />
                </div>
              )}
              {it.state === "error" && <p className="pl-7 text-[13px] text-reject-fg">{it.error}</p>}
            </li>
          ))}
        </ul>
      )}

      <div className="flex items-center justify-end gap-3">
        {waiting > 0 && !busy && <span className="text-[13px] text-muted-foreground">{waiting} ready</span>}
        <Button onClick={run} loading={busy} disabled={!waiting}>
          <Upload aria-hidden />
          Upload and analyse
        </Button>
      </div>
    </div>
  );
}
