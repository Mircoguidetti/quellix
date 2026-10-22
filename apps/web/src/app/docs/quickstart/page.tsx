import type { Metadata } from "next";
import { CodeBlock, Code } from "@/components/docs/code-block";
import { DocPage } from "@/components/docs/doc-page";
import { A, C, Callout, P, Soon, Step, Steps, Ul } from "@/components/docs/prose";

export const metadata: Metadata = {
  title: "Quickstart",
  description: "Install the Ormes SDK, create an API key and a rubric, upload a first-person video and read its decision.",
};

const TOC = [
  { id: "install", label: "Install the SDK" },
  { id: "api-key", label: "Create an API key" },
  { id: "rubric", label: "Create a rubric" },
  { id: "upload", label: "Upload a video" },
  { id: "decision", label: "Read the decision" },
  { id: "next", label: "Next steps" },
];

const INSTALL_TS = `npm install @ormes/sdk`;
const INSTALL_PY = `pip install ormes`;

const KEY_ENV = `export ORMES_API_KEY=orm_live_…`;

const CLIENT_TS = `
import { Ormes } from "@ormes/sdk";

// Reads ORMES_API_KEY (and ORMES_BASE_URL when you set it).
const ormes = new Ormes();
`;
const CLIENT_PY = `
from ormes import Ormes

# Reads ORMES_API_KEY (and ORMES_BASE_URL when you set it).
ormes = Ormes()
`;

const RUBRIC_TS = `
const rubric = await ormes.rubrics.create({
  name: "Load the dishwasher",
  task: {
    library_id: "load_dishwasher",
    description: "Load dirty plates and glasses into the dishwasher and close the door.",
  },
  checks: {
    hands_visible: { critical: true, min_ratio: 0.8 },
    technical: { min_duration_s: 20, min_width: 1280, min_height: 720 },
  },
});

console.log(rubric.id, rubric.version); // version is 1
`;
const RUBRIC_PY = `
rubric = ormes.rubrics.create({
    "name": "Load the dishwasher",
    "task": {
        "library_id": "load_dishwasher",
        "description": "Load dirty plates and glasses into the dishwasher and close the door.",
    },
    "checks": {
        "hands_visible": {"critical": True, "min_ratio": 0.8},
        "technical": {"min_duration_s": 20, "min_width": 1280, "min_height": 720},
    },
})

print(rubric.id, rubric.version)  # version is 1
`;
const RUBRIC_CURL = `
curl -X POST "$ORMES_BASE_URL/rubrics" \\
  -H "Authorization: Bearer $ORMES_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "name": "Load the dishwasher",
    "task": {
      "library_id": "load_dishwasher",
      "description": "Load dirty plates and glasses into the dishwasher and close the door."
    },
    "checks": {
      "hands_visible": { "critical": true, "min_ratio": 0.8 },
      "technical": { "min_duration_s": 20, "min_width": 1280, "min_height": 720 }
    }
  }'
`;

const UPLOAD_TS = `
const video = await ormes.videos.upload(
  "./v_88214.mp4",
  {
    rubric_id: rubric.id,
    external_id: "v_88214",      // your id for this video
    contributor_ref: "c_4471",   // opaque contributor id, never a name or email
  },
  {
    onProgress: ({ bytesUploaded, totalBytes }) =>
      console.log(\`\${Math.round((100 * bytesUploaded) / totalBytes)}%\`),
  },
);

console.log(video.id, video.status); // "queued"
`;
const UPLOAD_PY = `
video = ormes.videos.upload(
    "v_88214.mp4",
    rubric_id=rubric.id,
    external_id="v_88214",      # your id for this video
    contributor_ref="c_4471",   # opaque contributor id, never a name or email
    on_progress=lambda sent, total: print(f"{100 * sent // total}%"),
)

print(video.id, video.status.value)  # "queued"
`;
const UPLOAD_CURL = `
# 1. Register the video and get a signed upload URL
curl -X POST "$ORMES_BASE_URL/videos" \\
  -H "Authorization: Bearer $ORMES_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"rubric_id": "rub_…", "external_id": "v_88214", "filename": "v_88214.mp4",
       "content_type": "video/mp4", "size_bytes": 48211234}'

# 2. PUT the file to upload_url from the response (no API key on this request)
curl -X PUT "$UPLOAD_URL" -H "Content-Type: video/mp4" --data-binary @v_88214.mp4

# 3. Start the analysis
curl -X POST "$ORMES_BASE_URL/videos/$VIDEO_ID/complete" \\
  -H "Authorization: Bearer $ORMES_API_KEY"
`;

const WAIT_TS = `
const decided = await ormes.videos.waitForDecision(video.id, { timeoutMs: 600_000 });

console.log(decided.decision?.decision); // "accept" | "reject" | "review"
for (const reason of decided.decision?.reasons ?? []) {
  console.log(\`\${reason.effect}: \${reason.message}\`);
}
`;
const WAIT_PY = `
decided = ormes.videos.wait_for_decision(video.id, timeout=600)

if decided.decision:
    print(decided.decision.decision.value)  # "accept" | "reject" | "review"
    for reason in decided.decision.reasons:
        print(f"{reason.effect.value}: {reason.message}")
`;
const WAIT_CURL = `
curl "$ORMES_BASE_URL/videos/$VIDEO_ID" \\
  -H "Authorization: Bearer $ORMES_API_KEY"
`;

const DECIDED_JSON = `
{
  "id": "5b0c7f2e-…",
  "external_id": "v_88214",
  "status": "decided",
  "rubric_id": "rub_…",
  "rubric_version": 1,
  "decision": {
    "video_id": "5b0c7f2e-…",
    "decision": "review",
    "reasons": [
      {
        "check": "framing",
        "code": "framing.unstable",
        "message": "Unstable camera 14% of the time (maximum 10%).",
        "effect": "review"
      }
    ],
    "checks": {
      "framing": { "status": "fail", "measurements": { "off_target_ratio": 0.03, "unstable_ratio": 0.14 } },
      "hands_visible": { "status": "pass", "measurements": { "ratio_both_manipulation": 0.93 } }
    },
    "rubric": { "id": "rub_…", "version": 1 },
    "engine_version": "…"
  },
  "review": null,
  "lab_outcome": null,
  "created_at": "2026-10-22T09:14:03Z"
}
`;

export default function QuickstartPage() {
  return (
    <DocPage
      href="/docs/quickstart"
      toc={TOC}
      lead="From an API key to your first decision in five steps. Each step shows TypeScript, Python and, where it helps, the raw HTTP call."
    >
      <Steps>
        <Step id="install" title="Install the SDK">
          <P>
            The TypeScript SDK runs on Node 20+ and edge runtimes and has no runtime dependencies. The Python SDK needs Python 3.10+ and ships a sync client (
            <C>Ormes</C>) and an async one (<C>AsyncOrmes</C>).
          </P>
          <CodeBlock
            samples={[
              { lang: "ts", code: INSTALL_TS },
              { lang: "py", code: INSTALL_PY },
            ]}
            title="terminal"
          />
          <Callout kind="note" title="Not published yet">
            <C>@ormes/sdk</C> and <C>ormes</C> are not on npm and PyPI yet
            <Soon />. Until they are, every step below also works with plain HTTPS: pick the cURL tab.
          </Callout>
        </Step>

        <Step id="api-key" title="Create an API key">
          <P>
            In the dashboard, open <b className="font-medium">Settings → API keys</b> and create a key. It starts with <C>orm_live_</C> and is shown once: Ormes stores
            only a hash of it. Keep it on your server and pass it as an environment variable.
          </P>
          <Code lang="bash" title="terminal">
            {KEY_ENV}
          </Code>
          <CodeBlock
            samples={[
              { lang: "ts", code: CLIENT_TS },
              { lang: "py", code: CLIENT_PY },
            ]}
          />
          <P>
            Over HTTP, send the key as <C>Authorization: Bearer orm_live_…</C> on every request. The cURL examples use <C>$ORMES_BASE_URL</C> for the API base URL (see{" "}
            <A href="/docs/reference#base-url">Reference</A>).
          </P>
        </Step>

        <Step id="rubric" title="Create a rubric">
          <P>
            A rubric is the lab&apos;s spec for one task, written as checks with thresholds. Checks you leave out keep their defaults; see{" "}
            <A href="/docs/rubrics">Rubrics</A> for every field. You can also write it in the dashboard&apos;s rubric editor.
          </P>
          <CodeBlock
            samples={[
              { lang: "ts", code: RUBRIC_TS },
              { lang: "py", code: RUBRIC_PY },
              { lang: "bash", code: RUBRIC_CURL },
            ]}
          />
          <P>Every later save is a new version. A decision always records the rubric id and version it used.</P>
        </Step>

        <Step id="upload" title="Upload a video">
          <P>
            <C>upload</C> does three calls for you: it registers the video (<C>POST /videos</C>), sends the file straight to storage with the signed URL it gets back,
            and calls <C>/complete</C> to queue the analysis. The file never goes through the API itself.
          </P>
          <CodeBlock
            samples={[
              { lang: "ts", code: UPLOAD_TS },
              { lang: "py", code: UPLOAD_PY },
              { lang: "bash", code: UPLOAD_CURL },
            ]}
          />
          <Ul>
            <li>
              Accepted files: <C>video/mp4</C>, <C>video/quicktime</C> (.mov) and <C>video/webm</C>, up to 5 GB. The SDKs infer the type and size from the file.
            </li>
            <li>The signed upload URL is valid for two hours.</li>
            <li>
              <C>external_id</C> is unique in your organization: sending the same one twice returns <C>409 conflict</C>, which protects you from paying for a video twice.
            </li>
            <li>
              Already know what the lab decided? Pass <C>lab_outcome</C> here; see <A href="/docs/review#lab-outcomes">Lab outcomes</A>.
            </li>
          </Ul>
        </Step>

        <Step id="decision" title="Read the decision">
          <P>
            Analysis runs in the background. For a script or a first test, poll until the video is decided: <C>waitForDecision</C> polls with growing, jittered
            intervals and stops at <C>decided</C>, <C>failed</C> or <C>deleted</C>.
          </P>
          <CodeBlock
            samples={[
              { lang: "ts", code: WAIT_TS },
              { lang: "py", code: WAIT_PY },
              { lang: "bash", code: WAIT_CURL },
            ]}
          />
          <P>The video comes back with its decision, the reasons and every measurement:</P>
          <Code lang="json" title="200 OK">
            {DECIDED_JSON}
          </Code>
          <Callout kind="tip" title="In production, use a webhook">
            Instead of polling, let Ormes call you when a decision is ready. See <A href="/docs/webhooks">Webhooks</A>.
          </Callout>
        </Step>

        <Step id="next" title="Next steps">
          <Ul>
            <li>
              <A href="/docs/webhooks">Receive decisions by webhook</A> and verify their signature.
            </li>
            <li>
              <A href="/docs/decisions">Understand the decision rule</A>: when a video is rejected and when it goes to review.
            </li>
            <li>
              <A href="/docs/review">Record reviews and lab outcomes</A>, so Ormes can report its precision on rejections.
            </li>
          </Ul>
        </Step>
      </Steps>
    </DocPage>
  );
}
