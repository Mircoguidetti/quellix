import { z } from "zod";

// The pilot import CSV: what the collector's own reviewers already decided, one row per video.

export const MAX_PILOT_ROWS = 2000;
export const PILOT_CSV_COLUMNS = ["external_id", "reviewer_decision", "reviewer_minutes", "lab_outcome", "contributor_ref", "source_url"] as const;
const REQUIRED = ["external_id", "reviewer_decision"] as const;

/** RFC 4180: quoted fields, doubled quotes, CRLF or LF, a trailing newline or not. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const s = text.replace(/^﻿/, "");
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quoted) {
      if (c === '"') {
        if (s[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
    } else if (c === '"' && field === "") quoted = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && s[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((f) => f.trim() !== ""));
}

const decision = z
  .string()
  .trim()
  .toLowerCase()
  .transform((v) => (v === "accepted" ? "accept" : v === "rejected" ? "reject" : v))
  .pipe(z.enum(["accept", "reject"], { message: "must be accept or reject" }));

const optional = <T extends z.ZodTypeAny>(schema: T) => z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? undefined : v), schema.optional());

export const pilotRowSchema = z.object({
  external_id: z.string().trim().min(1, "is required").max(200, "is longer than 200 characters"),
  reviewer_decision: decision,
  reviewer_minutes: optional(z.coerce.number({ message: "must be a number" }).min(0, "cannot be negative").max(600, "is more than 600")),
  lab_outcome: optional(decision),
  contributor_ref: optional(z.string().trim().max(200, "is longer than 200 characters")),
  source_url: optional(
    z
      .string()
      .trim()
      .url("must be a URL")
      .refine((u) => u.startsWith("https://"), "must start with https://"),
  ),
});

export type PilotRow = z.infer<typeof pilotRowSchema>;
export type CsvProblem = { line: number; message: string };

/**
 * Header-driven: columns may come in any order, extra columns are ignored. Every problem names the
 * line (1 = header) so the collector can fix the file.
 */
export function parsePilotCsv(text: string): { rows: PilotRow[]; problems: CsvProblem[] } {
  const table = parseCsv(text);
  if (!table.length) return { rows: [], problems: [{ line: 1, message: "The file is empty." }] };
  const header = table[0].map((h) => h.trim().toLowerCase());
  const missing = REQUIRED.filter((c) => !header.includes(c));
  if (missing.length) return { rows: [], problems: [{ line: 1, message: `Missing column${missing.length > 1 ? "s" : ""}: ${missing.join(", ")}.` }] };
  if (table.length - 1 > MAX_PILOT_ROWS) {
    return { rows: [], problems: [{ line: 1, message: `A pilot holds at most ${MAX_PILOT_ROWS} videos; this file has ${table.length - 1}.` }] };
  }

  const rows: PilotRow[] = [];
  const problems: CsvProblem[] = [];
  const seen = new Map<string, number>();
  table.slice(1).forEach((cells, i) => {
    const line = i + 2;
    const raw: Record<string, string> = {};
    header.forEach((h, j) => {
      if ((PILOT_CSV_COLUMNS as readonly string[]).includes(h)) raw[h] = cells[j] ?? "";
    });
    const parsed = pilotRowSchema.safeParse(raw);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) problems.push({ line, message: `${String(issue.path[0] ?? "row")} ${issue.message}.` });
      return;
    }
    const first = seen.get(parsed.data.external_id);
    if (first) {
      problems.push({ line, message: `external_id ${parsed.data.external_id} is already on line ${first}.` });
      return;
    }
    seen.set(parsed.data.external_id, line);
    rows.push(parsed.data);
  });
  if (!rows.length && !problems.length) problems.push({ line: 2, message: "The file has a header but no rows." });
  return { rows, problems };
}

/** The file name without folders and extension, for matching a folder of videos to CSV rows. */
export function fileKey(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? name;
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(0, dot) : base;
}

/** Pairs files with rows: by exact file name first, then by name without extension. */
export function matchFiles<F extends { name: string }>(rows: PilotRow[], files: F[]): { matched: Map<string, F>; unmatchedFiles: F[] } {
  const byName = new Map<string, F>();
  const byStem = new Map<string, F>();
  for (const f of files) {
    const base = f.name.split(/[\\/]/).pop() ?? f.name;
    byName.set(base, f);
    if (!byStem.has(fileKey(base))) byStem.set(fileKey(base), f);
  }
  const matched = new Map<string, F>();
  const used = new Set<F>();
  for (const r of rows) {
    const f = byName.get(r.external_id) ?? byStem.get(r.external_id);
    if (f && !used.has(f)) {
      matched.set(r.external_id, f);
      used.add(f);
    }
  }
  return { matched, unmatchedFiles: files.filter((f) => !used.has(f)) };
}
