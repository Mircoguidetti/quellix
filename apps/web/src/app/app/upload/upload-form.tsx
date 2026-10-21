"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { finishUpload, startUpload } from "./actions";
import { badge, button, card, input, muted } from "@/components/ui";

type Rubric = { id: string; name: string; version: number };
type Item = { file: File; state: "waiting" | "uploading" | "queued" | "error"; progress: number; error?: string; videoId?: string };

const TYPES = ["video/mp4", "video/quicktime", "video/webm"];

function put(url: string, file: File, onProgress: (p: number) => void): Promise<void> {
  // Same wire format as supabase-js uploadToSignedUrl: PUT multipart straight to Storage.
  return new Promise((resolve, reject) => {
    const body = new FormData();
    body.append("cacheControl", "3600");
    body.append("", file);
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.setRequestHeader("x-upsert", "false");
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
    xhr.onload = () => (xhr.status < 300 ? resolve() : reject(new Error(`Upload failed (${xhr.status})`)));
    xhr.onerror = () => reject(new Error("Network error during upload"));
    xhr.send(body);
  });
}

export function UploadForm({ rubrics }: { rubrics: Rubric[] }) {
  const [rubricId, setRubricId] = useState(rubrics[0].id);
  const [lab, setLab] = useState<"" | "accept" | "reject">("");
  const [items, setItems] = useState<Item[]>([]);
  const [busy, setBusy] = useState(false);
  const picker = useRef<HTMLInputElement>(null);

  const update = (i: number, patch: Partial<Item>) =>
    setItems((list) => list.map((it, j) => (j === i ? { ...it, ...patch } : it)));

  function addFiles(files: FileList | File[]) {
    const ok = [...files].filter((f) => TYPES.includes(f.type));
    setItems((list) => [...list, ...ok.map((file) => ({ file, state: "waiting" as const, progress: 0 }))]);
  }

  async function run() {
    setBusy(true);
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      if (it.state !== "waiting") continue;
      update(i, { state: "uploading" });
      const start = await startUpload({
        rubric_id: rubricId,
        filename: it.file.name,
        content_type: it.file.type,
        size_bytes: it.file.size,
        ...(lab ? { lab_outcome: { outcome: lab } } : {}),
      });
      if (!start.ok) {
        update(i, { state: "error", error: start.error });
        continue;
      }
      try {
        await put(start.uploadUrl, it.file, (p) => update(i, { progress: p }));
        const done = await finishUpload(start.videoId);
        if (!done.ok) throw new Error(done.error);
        update(i, { state: "queued", progress: 1, videoId: start.videoId });
      } catch (e) {
        update(i, { state: "error", error: e instanceof Error ? e.message : "Upload failed", videoId: start.videoId });
      }
    }
    setBusy(false);
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-sm">
          Rubric
          <select value={rubricId} onChange={(e) => setRubricId(e.target.value)} className={input}>
            {rubrics.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name} (v{r.version})
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Lab outcome, if already known (optional)
          <select value={lab} onChange={(e) => setLab(e.target.value as typeof lab)} className={input}>
            <option value="">Not known</option>
            <option value="accept">Lab accepted</option>
            <option value="reject">Lab rejected</option>
          </select>
        </label>
      </div>

      <div
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          addFiles(e.dataTransfer.files);
        }}
        className={card + " flex flex-col items-center gap-2 border-dashed py-10 text-center"}
      >
        <p className={muted}>Drop MP4, MOV or WebM files here</p>
        <button type="button" className={button("secondary")} onClick={() => picker.current?.click()}>
          Choose files
        </button>
        <input
          ref={picker}
          type="file"
          multiple
          accept={TYPES.join(",")}
          className="hidden"
          onChange={(e) => e.target.files && addFiles(e.target.files)}
        />
      </div>

      {items.length > 0 && (
        <ul className="flex flex-col divide-y divide-zinc-200 rounded-lg border border-zinc-200 text-sm dark:divide-zinc-800 dark:border-zinc-800">
          {items.map((it, i) => (
            <li key={i} className="flex flex-wrap items-center gap-3 px-4 py-2">
              <span className="min-w-0 flex-1 truncate">{it.file.name}</span>
              {it.state === "uploading" && <span className="text-xs text-zinc-500">{Math.round(it.progress * 100)}%</span>}
              {it.state === "queued" && (
                <Link className={badge("accept")} href={`/app/videos/${it.videoId}`}>
                  queued
                </Link>
              )}
              {it.state === "error" && <span className="text-xs text-red-600 dark:text-red-400">{it.error}</span>}
              {it.state === "waiting" && <span className={badge("neutral")}>ready</span>}
            </li>
          ))}
        </ul>
      )}

      <button
        className={button("primary") + " self-start"}
        disabled={busy || !items.some((i) => i.state === "waiting")}
        onClick={run}
      >
        {busy ? "Uploading…" : "Upload and analyse"}
      </button>
    </div>
  );
}
