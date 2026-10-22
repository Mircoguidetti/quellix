import type { Metadata } from "next";
import type { ReactNode } from "react";
import example from "@quellix/contracts/examples/rubric.load_dishwasher.json";
import schema from "@quellix/contracts/rubric.schema.json";
import { CodeBlock, Code } from "@/components/docs/code-block";
import { DocPage } from "@/components/docs/doc-page";
import { A, C, Callout, FieldTable, H2, H3, P, Ul, type Field } from "@/components/docs/prose";

export const metadata: Metadata = {
  title: "Rubrics",
  description: "Write a lab's acceptance spec as an Ormes rubric: the task, six checks with their thresholds and defaults, versions, and a full JSON example.",
};

const TOC = [
  { id: "anatomy", label: "Anatomy of a rubric" },
  { id: "task", label: "The task" },
  { id: "checks", label: "Checks" },
  { id: "versions", label: "Versions" },
  { id: "example", label: "Full example" },
];

type JsonProp = { type?: string; enum?: string[]; default?: unknown; minimum?: number; maximum?: number; items?: { type?: string }; description?: string };
type JsonObject = { properties: Record<string, JsonProp>; required?: string[] };

function typeOf(p: JsonProp): string {
  if (p.enum) return p.enum.map((v) => `"${v}"`).join(" | ");
  if (p.type === "array") return `${p.items?.type ?? "any"}[]`;
  const range = p.minimum !== undefined && p.maximum !== undefined ? ` ${p.minimum}–${p.maximum}` : p.minimum !== undefined ? ` ≥ ${p.minimum}` : "";
  return `${p.type ?? "any"}${range}`;
}

/** Field rows from the JSON Schema, so types and defaults never drift from the contract. */
function fieldsFrom(object: JsonObject, descriptions: Record<string, ReactNode>): Field[] {
  return Object.entries(object.properties).map(([name, p]) => {
    const description = descriptions[name];
    if (description === undefined) throw new Error(`rubrics docs: no description for ${name}`);
    return {
      name,
      type: typeOf(p),
      default: p.default === undefined ? undefined : typeof p.default === "string" ? `"${p.default}"` : String(p.default),
      required: object.required?.includes(name),
      description,
    };
  });
}

const checks = schema.properties.checks.properties as unknown as Record<string, JsonObject>;

const COMMON = {
  enabled: "Run this check. A disabled check is reported as skipped and never affects the decision.",
  critical: (
    <>
      A failure rejects the video. When <C>false</C>, a failure sends it to review instead.
    </>
  ),
};

const CHECKS: { id: string; title: string; summary: ReactNode; descriptions: Record<string, ReactNode> }[] = [
  {
    id: "task_completed",
    title: "Task completed",
    summary: "Whether the contributor finished the task described in the rubric.",
    descriptions: {
      ...COMMON,
      min_confidence: "Below this confidence the result is uncertain, and an uncertain result always goes to review, never to reject.",
    },
  },
  {
    id: "hands_visible",
    title: "Hands visible",
    summary: "How much of the time the hands are in frame.",
    descriptions: {
      ...COMMON,
      scope: (
        <>
          <C>manipulation</C> measures only while the hands work on objects; <C>whole_video</C> measures from start to end.
        </>
      ),
      require_both: "Count a moment only when both hands are visible. When false, one hand is enough.",
      min_ratio: "Smallest share of the scope where the hands must be visible, from 0 to 1.",
    },
  },
  {
    id: "framing",
    title: "Framing",
    summary: "Whether the camera stays on the work and stays steady.",
    descriptions: {
      ...COMMON,
      max_off_target_ratio: "Largest share of the video where the camera may point away from the work.",
      max_unstable_ratio: "Largest share of the video where the camera may shake or swing.",
    },
  },
  {
    id: "technical",
    title: "Technical",
    summary: (
      <>
        Duration, resolution, frame rate, blur and exposure. Limits without a default are not checked until you set them. A file that cannot be decoded is always
        rejected.
      </>
    ),
    descriptions: {
      ...COMMON,
      min_duration_s: "Shortest accepted video, in seconds.",
      max_duration_s: "Longest accepted video, in seconds.",
      min_width: "Smallest accepted width, in pixels.",
      min_height: "Smallest accepted height, in pixels.",
      min_fps: "Lowest accepted frame rate.",
      max_blur_ratio: "Largest share of blurry frames.",
      max_bad_exposure_ratio: "Largest share of frames that are too dark or too bright.",
    },
  },
  {
    id: "privacy",
    title: "Privacy",
    summary: (
      <>
        Faces, readable documents and readable screens in frame. Each rule chooses what a detection does: <C>reject</C>, <C>review</C> or <C>ignore</C>. Privacy has
        no <C>critical</C> flag: the rule is the effect.
      </>
    ),
    descriptions: {
      enabled: COMMON.enabled,
      faces: "What a visible face does to the decision.",
      documents: "What a readable document (a letter, an ID, a label with personal data) does.",
      screens: "What a readable screen (phone, monitor, TV) does.",
    },
  },
  {
    id: "originality",
    title: "Originality",
    summary: (
      <>
        Whether this video was already delivered to you. Ormes compares each video with the fingerprints of the videos <em>your organization</em> sent before;
        fingerprints are never matched across customers.
      </>
    ),
    descriptions: {
      enabled: COMMON.enabled,
      similarity_threshold: "Similarity from which two videos count as the same, from 0 to 1.",
      on_duplicate: "What a duplicate does to the decision.",
    },
  },
];

const TASK_FIELDS = fieldsFrom(schema.properties.task as unknown as JsonObject, {
  library_id: (
    <>
      Id of a task in the Ormes task library, e.g. <C>load_dishwasher</C>. When absent, task completion falls back to a general model.
    </>
  ),
  description: "What the contributor has to do, in one sentence.",
  steps: "The steps in order, as the lab lists them.",
  final_state: "What the scene looks like when the task is done.",
});

const TOP_FIELDS: Field[] = [
  { name: "id", type: "string", description: "Assigned by Ormes when you create the rubric.", required: true },
  { name: "version", type: "integer ≥ 1", description: "Assigned by Ormes; every save adds one.", required: true },
  { name: "name", type: "string", description: "Shown in the dashboard and on reports.", required: true },
  { name: "task", type: "object", description: <>The task the video must show. See <A href="#task">The task</A>.</>, required: true },
  { name: "checks", type: "object", description: <>Settings of each check. Omitted checks and fields keep their defaults.</>, required: true },
];

const UPDATE_TS = `
const v2 = await ormes.rubrics.newVersion(rubric.id, {
  name: rubric.name,
  task: rubric.task,
  checks: { ...rubric.checks, framing: { critical: false, max_unstable_ratio: 0.15 } },
});

const pinned = await ormes.rubrics.get(rubric.id, { version: 1 }); // an older version
`;
const UPDATE_PY = `
v2 = ormes.rubrics.new_version(rubric.id, {
    "name": rubric.name,
    "task": rubric.task.model_dump(mode="json", exclude_none=True),
    "checks": {**rubric.checks.model_dump(mode="json", exclude_none=True), "framing": {"critical": False, "max_unstable_ratio": 0.15}},
})

pinned = ormes.rubrics.get(rubric.id, version=1)  # an older version
`;

export default function RubricsPage() {
  return (
    <DocPage
      href="/docs/rubrics"
      toc={TOC}
      lead="A rubric is the lab's acceptance spec for one task, written so a machine applies it the same way to every video. Checks produce measurements; the rubric's thresholds turn them into pass, fail or uncertain."
    >
      <H2 id="anatomy">Anatomy of a rubric</H2>
      <P>
        A rubric has a name, the task the video must show, and the settings of six checks. You send <C>name</C>, <C>task</C> and <C>checks</C>; Ormes assigns{" "}
        <C>id</C> and <C>version</C>.
      </P>
      <FieldTable fields={TOP_FIELDS} showDefault={false} caption="Rubric fields" />
      <Callout kind="note">
        Ormes validates every rubric against its schema. An unknown field or an out-of-range value returns <C>400 invalid_request</C> with the problems listed.
      </Callout>

      <H2 id="task">The task</H2>
      <P>The task tells the task-completion check what to look for.</P>
      <FieldTable fields={TASK_FIELDS} showDefault={false} caption="Task fields" />

      <H2 id="checks">Checks</H2>
      <P>
        Each check is optional in the rubric: leave it out and it runs with the defaults below. Whether a failure rejects or sends to review is decided by{" "}
        <C>critical</C> (or by the rule itself for privacy and originality); <A href="/docs/decisions#rule">Decisions</A> has the full rule.
      </P>
      {CHECKS.map((check) => (
        <section key={check.id} aria-labelledby={`check-${check.id}`}>
          <H3 id={`check-${check.id}`}>
            <span className="flex flex-wrap items-baseline gap-x-2.5">
              {check.title}
              <code className="font-mono text-[13px] font-normal text-muted-foreground">{check.id}</code>
            </span>
          </H3>
          <P className="mt-2">{check.summary}</P>
          <FieldTable fields={fieldsFrom(checks[check.id], check.descriptions)} caption={`${check.title} fields`} />
        </section>
      ))}

      <H2 id="versions">Versions</H2>
      <P>
        Rubrics are never edited in place. Every save, in the editor or with <C>PUT /rubrics/{"{id}"}</C>, creates the next version and keeps the old ones. Each
        decision records the rubric id and version it used, so a decision can always be explained by the spec that produced it.
      </P>
      <Ul>
        <li>
          New uploads use the latest version unless you pass <C>rubric_version</C>.
        </li>
        <li>
          <C>GET /rubrics/{"{id}"}</C> returns the latest version; add <C>?version=N</C> for an older one.
        </li>
      </Ul>
      <CodeBlock
        samples={[
          { lang: "ts", code: UPDATE_TS },
          { lang: "py", code: UPDATE_PY },
        ]}
      />

      <H2 id="example">Full example</H2>
      <P>Every field set, for a dishwasher-loading task. This is the example the rubric editor starts from.</P>
      <Code lang="json" title="rubric.load_dishwasher.json">
        {JSON.stringify(example, null, 2)}
      </Code>
    </DocPage>
  );
}
