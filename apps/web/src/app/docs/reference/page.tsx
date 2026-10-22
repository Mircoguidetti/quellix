import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Code, CodeBlock } from "@/components/docs/code-block";
import { DocPage } from "@/components/docs/doc-page";
import { A, C, Callout, DataTable, Endpoint, FieldTable, H2, H3, Method, P, Soon, type Field } from "@/components/docs/prose";

export const metadata: Metadata = {
  title: "API reference",
  description: "Every endpoint of the Ormes API: videos, reviews, lab outcomes and rubrics, with authentication, errors, limits and the video.decided webhook.",
};

const TOC = [
  { id: "base-url", label: "Base URL" },
  { id: "authentication", label: "Authentication" },
  { id: "errors", label: "Errors" },
  { id: "limits", label: "Limits" },
  { id: "videos", label: "Videos" },
  { id: "rubrics", label: "Rubrics" },
  { id: "webhook-event", label: "Webhook event" },
];

type Ep = { method: "GET" | "POST" | "PUT"; path: string; id: string; title: string };
const VIDEO_ENDPOINTS: Ep[] = [
  { method: "POST", path: "/videos", id: "create-video", title: "Create a video" },
  { method: "GET", path: "/videos", id: "list-videos", title: "List videos" },
  { method: "GET", path: "/videos/{video_id}", id: "get-video", title: "Get a video" },
  { method: "POST", path: "/videos/{video_id}/complete", id: "complete-upload", title: "Complete the upload" },
  { method: "POST", path: "/videos/{video_id}/review", id: "review-video", title: "Record a review" },
  { method: "POST", path: "/videos/{video_id}/lab-outcome", id: "lab-outcome", title: "Record the lab outcome" },
];
const RUBRIC_ENDPOINTS: Ep[] = [
  { method: "GET", path: "/rubrics", id: "list-rubrics", title: "List rubrics" },
  { method: "POST", path: "/rubrics", id: "create-rubric", title: "Create a rubric" },
  { method: "GET", path: "/rubrics/{rubric_id}", id: "get-rubric", title: "Get a rubric" },
  { method: "PUT", path: "/rubrics/{rubric_id}", id: "update-rubric", title: "Save a new version" },
];

const VIDEO_FIELDS: Field[] = [
  { name: "id", type: "string", required: true, description: "Ormes's id for the video." },
  { name: "external_id", type: "string | null", description: "Your id, as sent at creation." },
  { name: "status", type: "VideoStatus", required: true, description: <>See <A href="/docs/decisions#video-statuses">video statuses</A>.</> },
  { name: "rubric_id", type: "string", required: true, description: "The rubric applied." },
  { name: "rubric_version", type: "integer", required: true, description: "The rubric version applied." },
  { name: "decision", type: "Decision | null", description: <>Null until decided. See <A href="/docs/decisions#object">the decision object</A>.</> },
  { name: "review", type: "object | null", description: <>The latest human review: <C>decision</C>, <C>note</C>, <C>reviewed_at</C>.</> },
  { name: "lab_outcome", type: "object | null", description: <>What the lab decided: <C>outcome</C>, <C>reason</C>.</> },
  { name: "created_at", type: "date-time", required: true, description: "When the video was registered." },
];

const CREATE_VIDEO_FIELDS: Field[] = [
  { name: "rubric_id", type: "string", required: true, description: "The rubric to apply." },
  { name: "rubric_version", type: "integer ≥ 1", default: "latest", description: "Pin a specific version." },
  { name: "filename", type: "string ≤ 300", required: true, description: "The file's name." },
  { name: "content_type", type: '"video/mp4" | "video/quicktime" | "video/webm"', required: true, description: "The file's type." },
  { name: "size_bytes", type: "integer 1–5368709120", required: true, description: "Exact size of the file (5 GB at most)." },
  { name: "external_id", type: "string ≤ 200", description: "Your id for this video. Unique in your organization: a repeat returns 409." },
  { name: "contributor_ref", type: "string ≤ 200", description: "Opaque id of the contributor, used for contests. Never a name or email." },
  { name: "lab_outcome", type: "{ outcome, reason? }", description: <>The lab&apos;s decision, if you already know it. See <A href="#lab-outcome">lab outcome</A>.</> },
];

const CREATE_TS = `
// upload() = create + PUT + complete. Use create() when you upload the bytes yourself.
const { video, upload_url, upload_expires_at } = await ormes.videos.create({
  rubric_id: "rub_…",
  filename: "v_88214.mp4",
  content_type: "video/mp4",
  size_bytes: 48211234,
  external_id: "v_88214",
});
`;
const CREATE_PY = `
# upload() = create + PUT + complete. Use create() when you upload the bytes yourself.
created = ormes.videos.create(
    rubric_id="rub_…",
    filename="v_88214.mp4",
    content_type="video/mp4",
    size_bytes=48211234,
    external_id="v_88214",
)
print(created.video.id, created.upload_url, created.upload_expires_at)
`;
const CREATE_CURL = `
curl -X POST "$ORMES_BASE_URL/videos" \\
  -H "Authorization: Bearer $ORMES_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"rubric_id": "rub_…", "filename": "v_88214.mp4", "content_type": "video/mp4",
       "size_bytes": 48211234, "external_id": "v_88214"}'
`;
const CREATE_RESPONSE = `
{
  "video": { "id": "5b0c7f2e-…", "status": "awaiting_upload", "rubric_id": "rub_…", "rubric_version": 3, "external_id": "v_88214", "decision": null, … },
  "upload_url": "https://…",
  "upload_expires_at": "2026-10-22T11:14:03.000Z"
}
`;

const LIST_TS = `
for await (const video of ormes.videos.list({ decision: "review" })) {
  console.log(video.id, video.external_id);
}
// One page at a time: ormes.videos.listPage({ limit: 100, cursor })
`;
const LIST_PY = `
for video in ormes.videos.list(decision="review"):
    print(video.id, video.external_id)
# One page at a time: videos, next_cursor = ormes.videos.list_page(limit=100, cursor=cursor)
`;
const LIST_CURL = `
curl "$ORMES_BASE_URL/videos?decision=review&limit=100" \\
  -H "Authorization: Bearer $ORMES_API_KEY"
`;

function EndpointHead({ ep, sdk, children }: { ep: Ep; sdk?: { ts: string; py: string }; children?: ReactNode }) {
  return (
    <section aria-labelledby={ep.id} className="mt-12 border-t border-border pt-8">
      <H3 id={ep.id}>{ep.title}</H3>
      <Endpoint method={ep.method} path={ep.path} sdk={sdk} />
      {children}
    </section>
  );
}

export default function ReferencePage() {
  return (
    <DocPage
      href="/docs/reference"
      toc={TOC}
      lead="The Ormes API is JSON over HTTPS. This page lists every endpoint with its parameters, the SDK call that wraps it, and the errors and limits that apply."
    >
      <div className="rounded-xl border border-border">
        <p className="border-b border-border px-4 py-2.5 font-mono text-[11px] font-medium uppercase tracking-[0.1em] text-muted-foreground">Endpoints</p>
        <ul className="grid py-1.5">
          {[...VIDEO_ENDPOINTS, ...RUBRIC_ENDPOINTS].map((ep) => (
            <li key={ep.id}>
              <a href={`#${ep.id}`} className="flex min-w-0 items-center gap-3 px-4 py-1.5 transition-colors hover:bg-subtle">
                <Method method={ep.method} />
                <span className="min-w-0 truncate font-mono text-[13px] text-foreground/90">{ep.path}</span>
                <span className="ml-auto hidden shrink-0 text-[13px] text-muted-foreground sm:inline">{ep.title}</span>
              </a>
            </li>
          ))}
        </ul>
      </div>

      <H2 id="base-url">Base URL</H2>
      <P>
        All paths on this page are relative to the API base URL, <C>https://api.ormes.ai/v1</C>. The SDKs use the hosted API by default; set{" "}
        <C>ORMES_BASE_URL</C> (or the <C>baseUrl</C> / <C>base_url</C> option) to point them elsewhere. Request and response bodies are JSON.
      </P>

      <H2 id="authentication">Authentication</H2>
      <P>
        Send your organization&apos;s API key as a bearer token on every request. Keys start with <C>orm_live_</C> and are created in{" "}
        <b className="font-medium">Settings → API keys</b>; Ormes stores only a SHA-256 hash. Keys issued before the rename start with <C>qx_live_</C> and keep
        working. A revoked key stops working immediately.
      </P>
      <Code lang="http" title="header">
        {"Authorization: Bearer orm_live_…"}
      </Code>

      <H2 id="errors">Errors</H2>
      <P>Errors use standard HTTP status codes and one JSON shape:</P>
      <Code lang="json" title="error body">
        {`{
  "error": {
    "code": "invalid_request",
    "message": "size_bytes: Too big: expected number to be <=5368709120"
  }
}`}
      </Code>
      <DataTable
        caption="Error codes"
        head={["Status", "Code", "When", "SDK error"]}
        minWidth={640}
        rows={[
          ["400", <C key="c">invalid_request</C>, "The body or a query parameter is invalid; the message names the field. Also an invalid rubric or cursor.", <C key="e">ValidationError</C>],
          ["401", <C key="c">unauthorized</C>, "Missing, malformed or revoked API key.", <C key="e">AuthenticationError</C>],
          ["404", <C key="c">not_found</C>, "The video, rubric or rubric version does not exist in your organization.", <C key="e">NotFoundError</C>],
          ["409", <C key="c">conflict</C>, "external_id already used; /complete on a video not awaiting upload or whose file is missing; a rubric saved concurrently.", <C key="e">APIError</C>],
          ["429", <C key="c">rate_limited</C>, "Reserved for rate limiting; not returned by the API today. The SDKs already wait (Retry-After) and retry.", <C key="e">RateLimitError</C>],
          ["500", <C key="c">internal_error</C>, "Something failed on our side. Safe to retry reads.", <C key="e">APIError</C>],
        ]}
      />
      <P>
        The SDKs retry 429 and 5xx responses with jitter (2 retries by default). A <C>POST</C> is retried after a 5xx only when it carries an <C>Idempotency-Key</C>,
        which <C>videos.create</C> and <C>videos.upload</C> send for you. Always set <C>external_id</C> too: it is unique in your organization, so a
        retried create can never register the same video twice. Network failures raise <C>ConnectionError</C>; <C>waitForDecision</C> /{" "}
        <C>wait_for_decision</C> raise <C>TimeoutError</C>.
      </P>

      <H2 id="limits">Limits</H2>
      <DataTable
        caption="Limits"
        head={["Limit", "Value"]}
        minWidth={420}
        rows={[
          ["File size", "1 byte to 5 GB (5,368,709,120 bytes)"],
          ["File types", "video/mp4, video/quicktime (.mov), video/webm"],
          ["Signed upload URL", "Valid for 2 hours"],
          ["filename", "300 characters"],
          ["external_id, contributor_ref", "200 characters each"],
          ["Review note, lab outcome reason", "2,000 characters each"],
          ["List page size (limit)", "1 to 100, default 50"],
          ["Webhook delivery", "Once per endpoint, 15 s timeout, no retries yet"],
          ["Signature tolerance (SDKs)", "300 s, configurable"],
        ]}
      />
      <Callout kind="note" title="Rate limits">
        No request quota is enforced on the API today. Published per-key limits
        <Soon /> will use status <C>429</C>, which the SDKs already handle.
      </Callout>

      <H2 id="videos">Videos</H2>
      <P>A video is created, receives its file, is completed, and is then decided. The fields of a video:</P>
      <FieldTable fields={VIDEO_FIELDS} showDefault={false} caption="Video fields" />

      <EndpointHead ep={VIDEO_ENDPOINTS[0]} sdk={{ ts: "ormes.videos.create(params)", py: "ormes.videos.create(**params)" }}>
        <P>
          Registers a video and returns a signed URL to upload the file to, with a <C>PUT</C> and the file&apos;s <C>Content-Type</C>. Do not send your API key to
          that URL. Responds <C>201</C>.
        </P>
        <FieldTable fields={CREATE_VIDEO_FIELDS} caption="Create video body" />
        <CodeBlock
          samples={[
            { lang: "ts", code: CREATE_TS },
            { lang: "py", code: CREATE_PY },
            { lang: "bash", code: CREATE_CURL },
          ]}
        />
        <Code lang="json" title="201 Created">
          {CREATE_RESPONSE}
        </Code>
      </EndpointHead>

      <EndpointHead ep={VIDEO_ENDPOINTS[1]} sdk={{ ts: "ormes.videos.list(params) / listPage(params)", py: "ormes.videos.list(...) / list_page(...)" }}>
        <P>
          Videos of your organization, newest first. Returns <C>{"{ data: Video[], next_cursor }"}</C>; pass <C>next_cursor</C> as <C>cursor</C> for the next page. It
          is <C>null</C> on the last page. The SDKs&apos; <C>list</C> follows the cursor for you.
        </P>
        <FieldTable
          caption="List videos query"
          fields={[
            { name: "status", type: "VideoStatus", description: "Only videos in this status." },
            { name: "decision", type: '"accept" | "reject" | "review"', description: "Only videos with this decision." },
            { name: "cursor", type: "string", description: "From the previous page's next_cursor." },
            { name: "limit", type: "integer 1–100", default: "50", description: "Page size." },
          ]}
        />
        <CodeBlock
          samples={[
            { lang: "ts", code: LIST_TS },
            { lang: "py", code: LIST_PY },
            { lang: "bash", code: LIST_CURL },
          ]}
        />
      </EndpointHead>

      <EndpointHead ep={VIDEO_ENDPOINTS[2]} sdk={{ ts: "ormes.videos.get(id) / waitForDecision(id)", py: "ormes.videos.get(id) / wait_for_decision(id)" }}>
        <P>
          The video with its decision, review and lab outcome. <C>404</C> when it does not exist in your organization. <C>waitForDecision</C> polls this endpoint until
          the status is final (default timeout 10 minutes).
        </P>
      </EndpointHead>

      <EndpointHead ep={VIDEO_ENDPOINTS[3]} sdk={{ ts: "ormes.videos.complete(id)", py: "ormes.videos.complete(id)" }}>
        <P>
          Call after the file is uploaded: Ormes checks the file is in storage and queues the analysis. Responds <C>202</C> with the video in <C>queued</C>.{" "}
          <C>409</C> when the video is not <C>awaiting_upload</C> or the file has not arrived. No body.
        </P>
      </EndpointHead>

      <EndpointHead ep={VIDEO_ENDPOINTS[4]} sdk={{ ts: "ormes.review.submit(id, { decision, note })", py: "ormes.review.submit(id, decision=, note=)" }}>
        <P>
          A reviewer&apos;s final decision. Returns the video. See <A href="/docs/review#review">Record a review</A>.
        </P>
        <FieldTable
          showDefault={false}
          caption="Review body"
          fields={[
            { name: "decision", type: '"accept" | "reject"', required: true, description: "The reviewer's decision." },
            { name: "note", type: "string ≤ 2000", description: "What the reviewer checked." },
          ]}
        />
      </EndpointHead>

      <EndpointHead ep={VIDEO_ENDPOINTS[5]} sdk={{ ts: "ormes.labOutcome.submit(id, { outcome, reason })", py: "ormes.lab_outcome.submit(id, outcome=, reason=)" }}>
        <P>
          What the lab decided about the video, used to measure Ormes&apos;s precision. Returns the video. See <A href="/docs/review#lab-outcomes">Lab outcomes</A>.
        </P>
        <FieldTable
          showDefault={false}
          caption="Lab outcome body"
          fields={[
            { name: "outcome", type: '"accept" | "reject"', required: true, description: "The lab's decision." },
            { name: "reason", type: "string ≤ 2000", description: "The lab's reason, if it gave one." },
          ]}
        />
      </EndpointHead>

      <H2 id="rubrics">Rubrics</H2>
      <P>
        A rubric is returned whole: <C>id</C>, <C>version</C>, <C>name</C>, <C>task</C> and <C>checks</C>. Request bodies carry <C>name</C>, <C>task</C> and{" "}
        <C>checks</C>; <A href="/docs/rubrics">Rubrics</A> documents every field. An invalid rubric returns <C>400</C>.
      </P>
      <EndpointHead ep={RUBRIC_ENDPOINTS[0]} sdk={{ ts: "ormes.rubrics.list()", py: "ormes.rubrics.list()" }}>
        <P>
          The latest version of every rubric, as <C>{"{ data: Rubric[] }"}</C>. The SDKs return the array.
        </P>
      </EndpointHead>
      <EndpointHead ep={RUBRIC_ENDPOINTS[1]} sdk={{ ts: "ormes.rubrics.create(input)", py: "ormes.rubrics.create(input)" }}>
        <P>
          Creates a rubric at version 1. Responds <C>201</C>.
        </P>
      </EndpointHead>
      <EndpointHead ep={RUBRIC_ENDPOINTS[2]} sdk={{ ts: "ormes.rubrics.get(id, { version })", py: "ormes.rubrics.get(id, version=)" }}>
        <P>
          The latest version, or the one in <C>?version=N</C>. <C>404</C> when the rubric or the version does not exist.
        </P>
      </EndpointHead>
      <EndpointHead ep={RUBRIC_ENDPOINTS[3]} sdk={{ ts: "ormes.rubrics.newVersion(id, input)", py: "ormes.rubrics.new_version(id, input)" }}>
        <P>
          Saves the body as the next version and returns it. Old versions are kept, and decisions keep pointing to the version they used. <C>409</C> if another save
          happened at the same moment: fetch and retry.
        </P>
      </EndpointHead>

      <H2 id="webhook-event">Webhook event</H2>
      <P>
        <C>video.decided</C> is sent as a <C>POST</C> to each active endpoint, with the body <C>{"{ type, created_at, data: Video }"}</C> and the header{" "}
        <C>Ormes-Signature: t=…,v1=…</C>. Respond with any 2xx. <A href="/docs/webhooks">Webhooks</A> covers verification and delivery.
      </P>
    </DocPage>
  );
}
