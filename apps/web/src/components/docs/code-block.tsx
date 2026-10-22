import { CodePanel } from "./code-panel";
import { highlight, type CodeLang } from "./highlight";

const LABELS: Record<CodeLang, string> = { ts: "TypeScript", py: "Python", bash: "cURL", json: "JSON", http: "HTTP", text: "Text" };

export type CodeSample = { lang: CodeLang; code: string; label?: string };

/**
 * A code block. Several samples become language tabs (the choice is shared by every block);
 * the colouring is done here, on the server, so the client only receives the markup.
 */
export function CodeBlock({ samples, title }: { samples: CodeSample[]; title?: string }) {
  const tabs = samples.map((s) => {
    const code = s.code.replace(/^\n+|\s+$/g, "");
    return { id: s.lang, label: s.label ?? LABELS[s.lang], code, content: highlight(code, s.lang) };
  });
  return <CodePanel tabs={tabs} title={title} />;
}

/** Shorthand for a single-language block. */
export function Code({ lang, title, children }: { lang: CodeLang; title?: string; children: string }) {
  return <CodeBlock samples={[{ lang, code: children }]} title={title} />;
}
