/**
 * Local spec extractor: plain rules over each line of the lab's guidelines. No external call.
 * Every value it returns points at the line (and the words) it came from; anything the rubric
 * cannot express is reported as unsupported instead of being dropped.
 */

import type { CitedField, FieldPath, FieldValue, Unsupported } from "./types";
import type { SourceLine } from "./source";

const NUM = String.raw`(\d+(?:[.,]\d+)?)`;
const UNIT = String.raw`(seconds?|secs?|s|minutes?|mins?|m|hours?|hrs?|h)\b`;
const toNumber = (s: string) => Number(s.replace(",", "."));
const toSeconds = (n: number, unit: string) => (/^h/.test(unit) ? n * 3600 : /^m/.test(unit) ? n * 60 : n);

const RESOLUTIONS: Record<string, [number, number]> = {
  "720p": [1280, 720],
  "1080p": [1920, 1080],
  "1440p": [2560, 1440],
  "2160p": [3840, 2160],
  "4k": [3840, 2160],
};

const PROHIBIT = /\b(no|not|never|must not|mustn't|cannot|can't|don't|do not|avoid\w*|without|prohibited|forbidden|not allowed|exclude\w*|blur|hide|cover)\b/;
const STRONG = /\b(no|never|must not|mustn't|cannot|can't|do not|don't|prohibited|forbidden|not allowed|reject|rejected)\b/;

/** Requirements the rubric has no field for yet: shown to the collector, never silently dropped. */
const UNSUPPORTED: { re: RegExp; note: string }[] = [
  { re: /\b(landscape|portrait|horizontal|vertical)\b/, note: "Orientation is not checked yet." },
  { re: /\b(idle|inactiv\w*|pauses?|paused|standing still|no movement|dead time)\b/, note: "Idle time is not measured yet." },
  { re: /\b(staged|scripted|acted|acting|pretend\w*|fake|unnatural|natural(ly)?)\b/, note: "Staged or unnatural recording is not detected yet." },
  { re: /\b(audio|sound|talking|speech|speaking|narrat\w*|music)\b/, note: "Audio is not checked." },
  { re: /\b(head[- ]?mounted|chest[- ]?mounted|glasses|gopro|helmet|mounted camera|camera position)\b/, note: "Camera placement is not checked." },
  { re: /\bgloves?\b/, note: "Gloves are not detected." },
  { re: /\b(mp4|mov|h\.?264|h\.?265|hevc|codec|bitrate|file format)\b/, note: "File format and codec are not checked (any decodable MP4, MOV or WebM is accepted)." },
];

type Hit = { path: FieldPath; value: FieldValue; quote: string };

function hands(t: string): Hit[] {
  if (!/\bhands?\b/.test(t)) return [];
  const hits: Hit[] = [];
  const pct = t.match(/(\d{1,3}(?:\.\d+)?)\s?%/);
  const always = t.match(/\b(at all times|always|the whole time|entire(ly)? (time|video|clip)|throughout)\b/);
  const visible = /\b(visible|in (the )?frame|in view|on (camera|screen)|in shot|shown|seen)\b/.test(t);
  if (!visible) return [];
  const quoteOf = (m: RegExpMatchArray | null) => (m ? m[0] : t.match(/\bhands?\b/)![0]);
  if (pct && Number(pct[1]) <= 100) hits.push({ path: "checks.hands_visible.min_ratio", value: Number(pct[1]) / 100, quote: pct[0] });
  else if (always) hits.push({ path: "checks.hands_visible.min_ratio", value: 1, quote: always[0] });
  const both = t.match(/\b(both hands|two hands|each hand|left and right hands?)\b/);
  const one = t.match(/\b(at least one hand|one or both hands|either hand)\b/);
  if (both) hits.push({ path: "checks.hands_visible.require_both", value: true, quote: both[0] });
  else if (one) hits.push({ path: "checks.hands_visible.require_both", value: false, quote: one[0] });
  const during = t.match(/\b(while (manipulating|handling|interacting|working|performing)|during (the )?(manipulation|interaction|task|action)s?|when (handling|manipulating|interacting))\b/);
  const whole = t.match(/\b(entire|whole|full) (video|clip|recording|duration)\b|\bthroughout\b/);
  if (during) hits.push({ path: "checks.hands_visible.scope", value: "manipulation", quote: during[0] });
  else if (whole) hits.push({ path: "checks.hands_visible.scope", value: "whole_video", quote: whole[0] });
  return hits.length ? hits : [{ path: "checks.hands_visible.enabled", value: true, quote: quoteOf(null) }];
}

function technical(t: string): Hit[] {
  const hits: Hit[] = [];
  const fps = t.match(new RegExp(String.raw`${NUM}\s*(fps|frames per second|frames/s)\b`));
  if (fps && !/\b(at most|maximum|max|no more than|up to)\b/.test(t)) hits.push({ path: "checks.technical.min_fps", value: toNumber(fps[1]), quote: fps[0] });

  const wh = t.match(/\b(\d{3,4})\s*[x×]\s*(\d{3,4})\b/);
  const named = t.match(/\b(720p|1080p|1440p|2160p|4k)\b/);
  if (wh) {
    hits.push({ path: "checks.technical.min_width", value: Number(wh[1]), quote: wh[0] });
    hits.push({ path: "checks.technical.min_height", value: Number(wh[2]), quote: wh[0] });
  } else if (named) {
    const [w, h] = RESOLUTIONS[named[1]];
    hits.push({ path: "checks.technical.min_width", value: w, quote: named[0] });
    hits.push({ path: "checks.technical.min_height", value: h, quote: named[0] });
  }

  if (/\b(video|clip|recording|duration|length|long|footage)\b/.test(t) && !/\b(idle|pause|still|gap)\b/.test(t)) {
    const between = t.match(new RegExp(String.raw`\bbetween\s+${NUM}\s*(?:${UNIT})?\s*(?:and|to|-)\s*${NUM}\s*${UNIT}`));
    if (between) {
      const unit = between[2] ?? between[4];
      hits.push({ path: "checks.technical.min_duration_s", value: toSeconds(toNumber(between[1]), unit), quote: between[0] });
      hits.push({ path: "checks.technical.max_duration_s", value: toSeconds(toNumber(between[3]), between[4]), quote: between[0] });
    } else {
      const min = t.match(new RegExp(String.raw`\b(at least|minimum(?: of)?|min\.?|no (?:shorter|less) than|longer than|more than|over)\s*${NUM}\s*${UNIT}|(?:>=|≥)\s*${NUM}\s*${UNIT}`));
      const max = t.match(new RegExp(String.raw`\b(at most|maximum(?: of)?|max\.?|no (?:longer|more) than|shorter than|less than|under|up to|not exceed(?:ing)?)\s*${NUM}\s*${UNIT}|(?:<=|≤)\s*${NUM}\s*${UNIT}`));
      if (min) hits.push({ path: "checks.technical.min_duration_s", value: toSeconds(toNumber(min[2] ?? min[4]), min[3] ?? min[5]), quote: min[0] });
      if (max) hits.push({ path: "checks.technical.max_duration_s", value: toSeconds(toNumber(max[2] ?? max[4]), max[3] ?? max[5]), quote: max[0] });
    }
  }

  const ratioNear = (re: RegExp) => {
    if (!re.test(t)) return null;
    const p = t.match(/(\d{1,3}(?:\.\d+)?)\s?%/);
    return p && Number(p[1]) <= 100 ? { v: Number(p[1]) / 100, q: p[0] } : null;
  };
  const blur = ratioNear(/\b(blur\w*|out of focus|unfocused)\b/);
  if (blur) hits.push({ path: "checks.technical.max_blur_ratio", value: blur.v, quote: blur.q });
  const exposure = ratioNear(/\b(dark|underexposed|overexposed|exposure)\b/);
  if (exposure) hits.push({ path: "checks.technical.max_bad_exposure_ratio", value: exposure.v, quote: exposure.q });
  const shaky = ratioNear(/\b(shak\w*|unstable|stable|steady|jitter\w*)\b/);
  if (shaky) hits.push({ path: "checks.framing.max_unstable_ratio", value: shaky.v, quote: shaky.q });
  const offTarget = ratioNear(/\b(off[- ]target|pointed away|out of frame|look(ing)? away)\b/);
  if (offTarget && !/\bhands?\b/.test(t)) hits.push({ path: "checks.framing.max_off_target_ratio", value: offTarget.v, quote: offTarget.q });
  return hits;
}

function privacy(t: string): Hit[] {
  if (!PROHIBIT.test(t)) return [];
  const level = STRONG.test(t) ? "reject" : "review";
  const hits: Hit[] = [];
  const faces = t.match(/\b(faces?|facial|people'?s? faces?|bystanders?)\b/);
  const docs = t.match(/\b(documents?|papers?|paperwork|id cards?|ids|name tags?|badges?|labels? with names?)\b/);
  const screens = t.match(/\b(screens?|monitors?|displays?|phone screens?|laptops?|computer screens?)\b/);
  if (faces) hits.push({ path: "checks.privacy.faces", value: level, quote: faces[0] });
  if (docs) hits.push({ path: "checks.privacy.documents", value: level, quote: docs[0] });
  if (screens) hits.push({ path: "checks.privacy.screens", value: level, quote: screens[0] });
  return hits;
}

function originality(t: string): Hit[] {
  const m = t.match(/\b(duplicates?|re-?submi\w*|resubmi\w*|same video|already (been )?submitted|previously submitted|re-?upload\w*|reused?|recycled|copies|copied)\b/);
  return m ? [{ path: "checks.originality.on_duplicate", value: "reject", quote: m[0] }] : [];
}

const STEP_HEADING = /\b(steps?|procedure|instructions|sequence|how to perform|protocol)\b/;
const LIST_ITEM = /^\s*(?:\d+[.)]|[-*•]|step \d+[:.)]?)\s+(.+)$/i;

function task(lines: SourceLine[]): { hits: (Hit & { line: number })[] } {
  const hits: (Hit & { line: number })[] = [];
  for (const { n, text } of lines) {
    const m = text.match(/^\s*(?:task|task description|activity)\s*[:\-–]\s*(.{3,})$/i);
    if (m) {
      hits.push({ path: "task.description", value: m[1].trim(), quote: m[1].trim(), line: n });
      break;
    }
  }
  for (const { n, text } of lines) {
    const m = text.match(/\b(?:final state|end state|the task is (?:complete|done|finished) when|done when|finished when)\s*[:\-–]?\s*(.{3,})$/i);
    if (m) {
      hits.push({ path: "task.final_state", value: m[1].replace(/[.;]\s*$/, "").trim(), quote: m[1].trim(), line: n });
      break;
    }
  }
  const start = lines.findIndex((l) => STEP_HEADING.test(l.text.toLowerCase()) && !LIST_ITEM.test(l.text) && l.text.length < 80);
  if (start >= 0) {
    const steps: string[] = [];
    let first = 0;
    for (const l of lines.slice(start + 1)) {
      const m = l.text.match(LIST_ITEM);
      if (!m) {
        if (steps.length || l.text) break;
        continue;
      }
      if (!steps.length) first = l.n;
      steps.push(m[1].replace(/[.;]\s*$/, "").trim());
    }
    if (steps.length >= 2) hits.push({ path: "task.steps", value: steps, quote: lines[first - 1].text, line: first });
  }
  return { hits };
}

export function extractWithRules(lines: SourceLine[]): { fields: CitedField[]; unsupported: Unsupported[] } {
  const fields: CitedField[] = [];
  const unsupported: Unsupported[] = [];
  for (const { n, text } of lines) {
    if (!text) continue;
    const t = text.toLowerCase();
    for (const h of [...hands(t), ...technical(t), ...privacy(t), ...originality(t)]) {
      fields.push({ ...h, line: n, quote: excerpt(text, h.quote), source: "rules" });
    }
    for (const u of UNSUPPORTED) {
      const m = t.match(u.re);
      if (m) unsupported.push({ line: n, quote: excerpt(text, m[0]), note: u.note });
    }
  }
  for (const h of task(lines).hits) fields.push({ path: h.path, value: h.value, line: h.line, quote: excerpt(lines[h.line - 1].text, String(h.quote).toLowerCase()), source: "rules" });
  return { fields, unsupported };
}

/** The original-case words around a lower-cased match, so the citation reads naturally. */
function excerpt(text: string, needle: string): string {
  const i = text.toLowerCase().indexOf(needle.toLowerCase());
  if (i < 0) return text.slice(0, 160);
  const from = Math.max(0, text.lastIndexOf(" ", Math.max(0, i - 40)) + 1);
  const to = Math.min(text.length, text.indexOf(" ", i + needle.length + 40) === -1 ? text.length : text.indexOf(" ", i + needle.length + 40));
  return text.slice(from, to).trim().slice(0, 200);
}
