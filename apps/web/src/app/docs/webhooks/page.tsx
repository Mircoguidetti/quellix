import type { Metadata } from "next";
import { CodeBlock, Code } from "@/components/docs/code-block";
import { DocPage } from "@/components/docs/doc-page";
import { A, C, Callout, DataTable, H2, H3, P, Soon, Ul } from "@/components/docs/prose";

export const metadata: Metadata = {
  title: "Webhooks",
  description: "Receive the video.decided event from Ormes, verify the Ormes-Signature header in TypeScript or Python, and reconcile by polling.",
};

const TOC = [
  { id: "event", label: "The video.decided event" },
  { id: "endpoint", label: "Add an endpoint" },
  { id: "signature", label: "Verify the signature" },
  { id: "manual", label: "Verify without the SDK" },
  { id: "delivery", label: "Delivery and retries" },
  { id: "reconcile", label: "Reconcile by polling" },
];

const EVENT_JSON = `
{
  "type": "video.decided",
  "created_at": "2026-10-22T09:16:41.204417+00:00",
  "data": {
    "id": "5b0c7f2e-…",
    "external_id": "v_88214",
    "status": "decided",
    "rubric_id": "rub_…",
    "rubric_version": 3,
    "decision": {
      "video_id": "5b0c7f2e-…",
      "decision": "reject",
      "reasons": [
        {
          "check": "hands_visible",
          "code": "hands_visible.below_min",
          "message": "Both hands visible 61% of the time during manipulation (minimum 80%).",
          "effect": "reject"
        }
      ],
      "checks": { "hands_visible": { "status": "fail", "measurements": { "ratio_both_manipulation": 0.61 } } },
      "rubric": { "id": "rub_…", "version": 3 },
      "engine_version": "…"
    },
    "review": null,
    "lab_outcome": null,
    "created_at": "2026-10-22T09:14:03.118Z"
  }
}
`;

const HEADER = `
POST /hooks/ormes HTTP/1.1
Content-Type: application/json
Ormes-Signature: t=1761124601,v1=9c3f0e5b2a…d41e
`;

const VERIFY_TS = `
// app/hooks/ormes/route.ts (Next.js). Any framework works: read the raw body.
import { WebhookSignatureError, constructEvent, signatureFromHeaders } from "@ormes/sdk";

export async function POST(request: Request) {
  const raw = await request.text(); // the exact bytes Ormes sent, not parsed JSON

  try {
    const event = await constructEvent(raw, signatureFromHeaders(request.headers), process.env.ORMES_WEBHOOK_SECRET!);
    const { id, external_id, decision } = event.data;
    await recordDecision(id, external_id, decision); // your code: keep it quick
    return new Response(null, { status: 204 });
  } catch (error) {
    if (error instanceof WebhookSignatureError) return new Response("invalid signature", { status: 400 });
    throw error;
  }
}
`;

const VERIFY_PY = `
# FastAPI. Any framework works: read the raw body.
import os

from fastapi import FastAPI, HTTPException, Request
from ormes import WebhookSignatureError, construct_event, signature_from_headers

app = FastAPI()


@app.post("/hooks/ormes", status_code=204)
async def ormes_webhook(request: Request) -> None:
    raw = await request.body()  # the exact bytes Ormes sent, not parsed JSON
    try:
        event = construct_event(raw, signature_from_headers(request.headers), os.environ["ORMES_WEBHOOK_SECRET"])
    except WebhookSignatureError:
        raise HTTPException(status_code=400, detail="invalid signature") from None
    record_decision(event.data.id, event.data.external_id, event.data.decision)  # your code
`;

const MANUAL_TS = `
import { createHmac, timingSafeEqual } from "node:crypto";

export function verifyOrmesSignature(rawBody: string, header: string, secret: string, toleranceS = 300): boolean {
  const parts = new Map(header.split(",").map((p) => p.trim().split("=", 2) as [string, string]));
  const t = parts.get("t");
  const v1 = parts.get("v1");
  if (!t || !/^\\d+$/.test(t) || !v1) return false;
  if (Math.abs(Date.now() / 1000 - Number(t)) > toleranceS) return false; // replay

  const expected = createHmac("sha256", secret).update(\`\${t}.\${rawBody}\`).digest();
  const given = Buffer.from(v1, "hex");
  return given.length === expected.length && timingSafeEqual(given, expected);
}
`;

const MANUAL_PY = `
import hashlib
import hmac
import time


def verify_ormes_signature(raw_body: bytes, header: str, secret: str, tolerance: int = 300) -> bool:
    parts = dict(p.strip().split("=", 1) for p in header.split(",") if "=" in p)
    t, v1 = parts.get("t", ""), parts.get("v1", "")
    if not t.isdigit() or not v1:
        return False
    if abs(time.time() - int(t)) > tolerance:  # replay
        return False
    expected = hmac.new(secret.encode(), f"{t}.".encode() + raw_body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, v1)
`;

const RECONCILE_TS = `
// Every few minutes: catch decisions whose webhook you missed.
const since = Date.now() - 24 * 60 * 60 * 1000; // videos created in the last day

for await (const video of ormes.videos.list({ status: "decided", limit: 100 })) {
  if (Date.parse(video.created_at) < since) break; // newest first: the rest is older
  if (!(await alreadyRecorded(video.id))) await recordDecision(video.id, video.external_id, video.decision);
}
`;

const RECONCILE_PY = `
# Every few minutes: catch decisions whose webhook you missed.
from datetime import datetime, timedelta, timezone

since = datetime.now(timezone.utc) - timedelta(days=1)  # videos created in the last day

for video in ormes.videos.list(status="decided", limit=100):
    if video.created_at < since:
        break  # newest first: the rest is older
    if not already_recorded(video.id):
        record_decision(video.id, video.external_id, video.decision)
`;

export default function WebhooksPage() {
  return (
    <DocPage
      href="/docs/webhooks"
      toc={TOC}
      lead={
        <>
          Ormes calls your endpoint with a <C>video.decided</C> event as soon as a decision is ready. Each request is signed, so you can check that it comes from
          Ormes and was not replayed.
        </>
      }
    >
      <H2 id="event">The video.decided event</H2>
      <P>
        The body is JSON with three fields: <C>type</C> (always <C>video.decided</C> today), <C>created_at</C>, and <C>data</C>, the same <C>Video</C> object that{" "}
        <C>GET /videos/{"{id}"}</C> returns, decision included.
      </P>
      <Code lang="json" title="request body">
        {EVENT_JSON}
      </Code>
      <P>
        In this payload <C>review</C> and <C>lab_outcome</C> are always <C>null</C>; fetch the video when you need their current values. A video whose processing
        fails ends in status <C>failed</C> and does not send an event.
      </P>

      <H2 id="endpoint">Add an endpoint</H2>
      <P>
        In the dashboard, open <b className="font-medium">Settings → Webhooks</b> and add your URL. It must use <C>https://</C>. Ormes shows the endpoint&apos;s signing
        secret (<C>whsec_…</C>) once: store it as <C>ORMES_WEBHOOK_SECRET</C> next to your API key. You can pause an endpoint and resume it later; a paused endpoint
        receives nothing.
      </P>

      <H2 id="signature">Verify the signature</H2>
      <P>Every request carries an <C>Ormes-Signature</C> header with a timestamp and a signature:</P>
      <Code lang="http" title="request headers">
        {HEADER}
      </Code>
      <DataTable
        caption="Ormes-Signature parts"
        head={["Part", "Meaning"]}
        minWidth={440}
        rows={[
          [<C key="t">t</C>, "Unix time in seconds when Ormes signed the request."],
          [
            <C key="v1">v1</C>,
            <>
              Hex HMAC-SHA256 of the string <C>{"<t>.<raw body>"}</C>, keyed with your endpoint&apos;s signing secret.
            </>,
          ],
        ]}
      />
      <P>
        The SDKs check both, in constant time, and reject a timestamp more than 300 seconds away from your clock (configurable: <C>toleranceSeconds</C> in TypeScript,{" "}
        <C>tolerance</C> in Python). <C>constructEvent</C> / <C>construct_event</C> verify and return the typed event; <C>verifySignature</C> /{" "}
        <C>verify_signature</C> only return a boolean.
      </P>
      <CodeBlock
        samples={[
          { lang: "ts", code: VERIFY_TS },
          { lang: "py", code: VERIFY_PY },
        ]}
      />
      <Callout kind="warning" title="Use the raw body">
        The signature covers the exact bytes Ormes sent. Parsing the JSON and serializing it again changes them and the check fails. In Express, use{" "}
        <C>express.raw({"{ type: \"application/json\" }"})</C> on this route.
      </Callout>
      <P>
        Endpoints set up before the rename may also see the header name <C>Quellix-Signature</C>, with the same format. <C>signatureFromHeaders</C> /{" "}
        <C>signature_from_headers</C> read <C>Ormes-Signature</C> first and fall back to it.
      </P>

      <H2 id="manual">Verify without the SDK</H2>
      <P>The check is a few lines in any language. Recompute the HMAC over the raw body, compare in constant time and reject old timestamps.</P>
      <CodeBlock
        samples={[
          { lang: "ts", code: MANUAL_TS },
          { lang: "py", code: MANUAL_PY },
        ]}
      />

      <H2 id="delivery">Delivery and retries</H2>
      <Ul>
        <li>Ormes sends the event once to every active endpoint of your organization, with a 15 second timeout.</li>
        <li>Any 2xx response counts as received. Answer quickly and do slow work afterwards.</li>
        <li>
          There are no automatic retries today. If your endpoint is down or times out, that delivery is lost; the decision itself is safe and readable through the API.
        </li>
      </Ul>
      <H3>
        Automatic retries
        <Soon />
      </H3>
      <P>
        Retries with backoff are planned. When they arrive, the same event may reach you more than once, so make your handler idempotent now: key it on{" "}
        <C>data.id</C> and ignore a decision you already recorded.
      </P>

      <H2 id="reconcile">Reconcile by polling</H2>
      <P>
        Because a delivery can be missed, treat the API as the source of truth. A small periodic job that lists recently decided videos catches anything a webhook
        did not deliver. For a single video, <C>waitForDecision</C> / <C>wait_for_decision</C> or <C>GET /videos/{"{id}"}</C> does the same.
      </P>
      <CodeBlock
        samples={[
          { lang: "ts", code: RECONCILE_TS },
          { lang: "py", code: RECONCILE_PY },
        ]}
      />
      <P>
        Videos are listed newest first by creation time; pick a window longer than your slowest analysis. See <A href="/docs/reference#list-videos">List videos</A> for the filters.
      </P>
    </DocPage>
  );
}
