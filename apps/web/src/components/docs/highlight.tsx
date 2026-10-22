import type { ReactNode } from "react";

export type CodeLang = "ts" | "py" | "bash" | "json" | "http" | "text";

const KEYWORDS: Record<CodeLang, string[]> = {
  ts: ["import", "from", "export", "const", "let", "await", "async", "function", "return", "new", "if", "else", "throw", "try", "catch", "for", "of", "type", "interface", "true", "false", "null", "undefined", "instanceof", "default"],
  py: ["import", "from", "def", "async", "await", "return", "if", "else", "elif", "raise", "try", "except", "for", "in", "with", "as", "None", "True", "False", "not", "and", "or", "class", "is"],
  bash: ["export", "curl", "npm", "pip", "pnpm", "uv"],
  json: ["true", "false", "null"],
  http: ["GET", "POST", "PUT", "HTTP"],
  text: [],
};

const STRING = String.raw`"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'|\x60(?:\\.|[^\x60\\])*\x60`;
const NUMBER = String.raw`\b\d+(?:[._]\d+)*\b`;
const IDENT = String.raw`[A-Za-z_$][\w$]*`;

function pattern(lang: CodeLang): RegExp {
  const comment = lang === "ts" ? "//[^\\n]*" : lang === "py" || lang === "bash" ? "#[^\\n]*" : "(?!)";
  const variable = lang === "bash" ? "\\$[A-Za-z_]\\w*" : "(?!)";
  return new RegExp(`(${comment})|(${STRING})|(${variable})|(${NUMBER})|(${IDENT})`, "g");
}

/** Tiny hand-written colouring: comments, strings, keywords, numbers and JSON keys. */
export function highlight(code: string, lang: CodeLang): ReactNode[] {
  if (lang === "text") return [code];
  const out: ReactNode[] = [];
  const keywords = new Set(KEYWORDS[lang]);
  const re = pattern(lang);
  let last = 0;
  let key = 0;
  for (let m = re.exec(code); m; m = re.exec(code)) {
    if (m.index > last) out.push(code.slice(last, m.index));
    const [text, comment, str, variable, num, ident] = m;
    let cls: string | undefined;
    if (comment) cls = "text-[#7d8590] italic";
    else if (str) cls = lang === "json" && /^\s*:/.test(code.slice(m.index + text.length)) ? "text-[#c9d1d9]" : "text-[#9ee6bd]";
    else if (variable) cls = "text-[#f2c48d]";
    else if (num) cls = "text-[#f2c48d]";
    else if (ident && keywords.has(ident)) cls = "text-[#a8c4ff]";
    else if (ident && /^[A-Z]/.test(ident) && lang !== "http") cls = "text-[#e6c2ff]";
    out.push(cls ? (
      <span key={key++} className={cls}>
        {text}
      </span>
    ) : (
      text
    ));
    last = m.index + text.length;
  }
  if (last < code.length) out.push(code.slice(last));
  return out;
}
