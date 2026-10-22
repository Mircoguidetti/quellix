import "server-only";
/**
 * Optional extraction with a general model (Gemini). Only called when the organization allows
 * external models AND the deployment allows them (see `externalModelsAllowed`). The model only
 * proposes; `verifyProposals` keeps a value only if its path is in the rubric schema, its value is
 * in range and its quote really is on the cited line.
 */

import { z } from "zod";
import { VALUE_CHECKS, isFieldPath } from "./assemble";
import { quoteOnLine, type SourceLine } from "./source";
import { FIELD_PATHS, type CitedField, type Unsupported } from "./types";

export const GEMINI_MODEL = "gemini-2.5-flash";
const TIMEOUT_MS = 30_000;

const proposalSchema = z.object({
  fields: z.array(z.object({ path: z.string(), value: z.unknown(), line: z.number().int(), quote: z.string() })).max(100),
  unsupported: z.array(z.object({ line: z.number().int(), quote: z.string(), note: z.string().max(300) })).max(100).default([]),
});
export type Proposals = z.infer<typeof proposalSchema>;

export function verifyProposals(lines: SourceLine[], raw: unknown): { fields: CitedField[]; unsupported: Unsupported[]; warnings: string[] } {
  const parsed = proposalSchema.safeParse(raw);
  if (!parsed.success) return { fields: [], unsupported: [], warnings: ["The external model returned an unreadable answer; only the local rules were used."] };
  const fields: CitedField[] = [];
  const warnings: string[] = [];
  for (const p of parsed.data.fields) {
    if (!isFieldPath(p.path)) {
      warnings.push(`Ignored a model suggestion for "${p.path}": the rubric has no such field.`);
      continue;
    }
    const value = typeof p.value === "string" && p.path === "task.steps" ? [p.value] : p.value;
    if (!VALUE_CHECKS[p.path](value)) {
      warnings.push(`Ignored a model suggestion for ${p.path}: ${JSON.stringify(p.value)} is not a valid value.`);
      continue;
    }
    if (!quoteOnLine(lines, p.line, p.quote)) {
      warnings.push(`Ignored a model suggestion for ${p.path}: its citation was not found on line ${p.line}.`);
      continue;
    }
    fields.push({ path: p.path, value: value as CitedField["value"], line: p.line, quote: p.quote.slice(0, 200), source: "model" });
  }
  const unsupported = parsed.data.unsupported.filter((u) => quoteOnLine(lines, u.line, u.quote)).map((u) => ({ ...u, quote: u.quote.slice(0, 200) }));
  return { fields, unsupported, warnings };
}

export function buildPrompt(lines: SourceLine[]): string {
  const numbered = lines.map((l) => `${l.n}: ${l.text}`).join("\n");
  return [
    "You turn a data lab's video-collection guidelines into a rubric draft.",
    `Only use these paths: ${FIELD_PATHS.join(", ")}.`,
    "Ratios are 0-1 (80% -> 0.8). Durations are seconds. privacy.* is reject|review|ignore; originality.on_duplicate is reject|review; hands_visible.scope is manipulation|whole_video; task.steps is a list of strings.",
    "Every field needs `line` (the number before the colon) and `quote`: words copied verbatim from that line. Never infer a value the text does not state.",
    "List requirements that none of the paths can express under `unsupported` with their line, verbatim quote and a short note.",
    "Guidelines (numbered lines):",
    numbered,
  ].join("\n");
}

const RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    fields: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          path: { type: "STRING", enum: [...FIELD_PATHS] },
          value_number: { type: "NUMBER" },
          value_string: { type: "STRING" },
          value_boolean: { type: "BOOLEAN" },
          value_list: { type: "ARRAY", items: { type: "STRING" } },
          line: { type: "INTEGER" },
          quote: { type: "STRING" },
        },
        required: ["path", "line", "quote"],
      },
    },
    unsupported: {
      type: "ARRAY",
      items: { type: "OBJECT", properties: { line: { type: "INTEGER" }, quote: { type: "STRING" }, note: { type: "STRING" } }, required: ["line", "quote", "note"] },
    },
  },
  required: ["fields", "unsupported"],
};

type GeminiField = { path: string; value_number?: number; value_string?: string; value_boolean?: boolean; value_list?: string[]; line: number; quote: string };

/** Gemini's structured output cannot express "any JSON value", so values come in typed slots. */
export function fromGemini(json: { fields?: GeminiField[]; unsupported?: unknown[] }): Proposals | unknown {
  return {
    fields: (json.fields ?? []).map((f) => ({
      path: f.path,
      value: f.value_list ?? f.value_boolean ?? f.value_number ?? f.value_string,
      line: f.line,
      quote: f.quote,
    })),
    unsupported: json.unsupported ?? [],
  };
}

export async function proposeWithGemini(lines: SourceLine[], apiKey: string, fetchImpl: typeof fetch = fetch): Promise<unknown> {
  const res = await fetchImpl(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: buildPrompt(lines) }] }],
      generationConfig: { temperature: 0, responseMimeType: "application/json", responseSchema: RESPONSE_SCHEMA },
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`Gemini answered ${res.status}`);
  const body = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
  const textOut = body.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
  return fromGemini(JSON.parse(textOut));
}
