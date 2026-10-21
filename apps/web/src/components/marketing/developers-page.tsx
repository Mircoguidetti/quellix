// Generated from docs/design/site/developers.html (issue #35). Keep the copy and structure in step with the design.
import { Fragment } from "react";
import Link from "next/link";
import { CodeTabs } from "./code-tabs";
import { SiteFooter } from "./site-footer";

export function DevelopersPage() {
  return (
    <main>{" "}
      <section className="ph1">
        <div className="hc">{" "}
          <div className="eyebrow">Developers</div>{" "}
          <h1>Three calls from upload to decision.</h1>{" "}
          <p className="hl">A REST API with TypeScript and Python SDKs. Create a video, upload the file, get the decision by webhook.</p>{" "}
          <div className="hb">
            <span className="x-t">npm install @quellix/sdk</span>
            <span className="x-t">pip install quellix</span>
            <span className="badge">early access</span></div>{" "}
          <nav className="toc" aria-label="On this page">
            <a href="#quickstart">Quickstart</a>
            <a href="#endpoints">Endpoints</a>
            <a href="#decision">Decision object</a>
            <a href="#webhooks">Webhooks</a>
            <a href="#errors">Errors</a></nav>{" "}</div></section>{" "}
      <section className="sec" id="quickstart">
        <div className="wrap">{" "}
          <h2>Quickstart</h2>{" "}
          <p className="lead">{"Create an API key in Settings. The SDK reads it from "}
            <code className="x-t">QUELLIX_API_KEY</code>.</p>{" "}
          <div className="int">{" "}
            <div className="steps">{" "}
              <div>
                <b>1</b>
                <h3>Create the video</h3>
                <p>
                  <code>POST /v1/videos</code>{" with the rubric and file details returns a signed "}
                  <code>upload_url</code>.</p></div>{" "}
              <div>
                <b>2</b>
                <h3>Upload the file</h3>
                <p>
                  <code>PUT</code>{" the raw bytes to "}
                  <code>upload_url</code>{", then "}
                  <code>{"POST /v1/videos/{id}/complete"}</code>.</p></div>{" "}
              <div>
                <b>3</b>
                <h3>Get the decision</h3>
                <p>{"The "}
                  <code>video.decided</code>{" webhook, or "}
                  <code>{"GET /v1/videos/{id}"}</code>{". The SDK\u2019s "}
                  <code>upload()</code>{" and "}
                  <code>waitForDecision()</code>{" do all three."}</p></div>{" "}</div>{" "}
            <CodeTabs
              className="code"
              labels={["TypeScript", "Python", "cURL"]}
              panels={[
                <Fragment key={0}><span className="k">{"import"}</span>{" { Quellix } "}<span className="k">{"from"}</span>{" "}<span className="s">{"\"@quellix/sdk\""}</span>{";\n\n"}<span className="k">{"const"}</span>{" qx = "}<span className="k">{"new"}</span>{" Quellix(); "}<span className="c">{"// reads QUELLIX_API_KEY"}</span>{"\n\n"}<span className="k">{"const"}</span>{" video = "}<span className="k">{"await"}</span>{" qx.videos.upload("}<span className="s">{"\"./v_88214.mp4\""}</span>{", {\n  rubricId: "}<span className="s">{"\"rub_load_dishwasher\""}</span>{",\n  contributorRef: "}<span className="s">{"\"c_4086\""}</span>{",\n});\n"}<span className="k">{"const"}</span>{" d = "}<span className="k">{"await"}</span>{" qx.videos.waitForDecision(video.id);\n\nd.decision;      "}<span className="c">{"// \"reject\""}</span>{"\nd.reasons[0];    "}<span className="c">{"// hands_visible.below_min, 61% (min 80%)"}</span></Fragment>,
                <Fragment key={1}><span className="k">{"from"}</span>{" quellix "}<span className="k">{"import"}</span>{" Quellix\n\nqx = Quellix()  "}<span className="c">{"# reads QUELLIX_API_KEY"}</span>{"\n\nvideo = qx.videos.upload("}<span className="s">{"\"v_88214.mp4\""}</span>{",\n                         rubric_id="}<span className="s">{"\"rub_load_dishwasher\""}</span>{",\n                         contributor_ref="}<span className="s">{"\"c_4086\""}</span>{")\nd = qx.videos.wait_for_decision(video.id)\n\nd.decision      "}<span className="c">{"# \"reject\""}</span>{"\nd.reasons[0]    "}<span className="c">{"# hands_visible.below_min, 61% (min 80%)"}</span></Fragment>,
                <Fragment key={2}><span className="c">{"# 1. register the video, get a signed upload URL"}</span>{"\ncurl -X POST $QX/v1/videos -H "}<span className="s">{"\"Authorization: Bearer $QUELLIX_API_KEY\""}</span>{" \\\n  -d "}<span className="s">{"'{\"rubric_id\":\"rub_load_dishwasher\",\"filename\":\"v_88214.mp4\",\n       \"content_type\":\"video/mp4\",\"size_bytes\":48211234}'"}</span>{"\n"}<span className="c">{"# 2. PUT the file to upload_url"}</span>{"\ncurl -X PUT "}<span className="s">{"\"$UPLOAD_URL\""}</span>{" -H "}<span className="s">{"\"Content-Type: video/mp4\""}</span>{" --data-binary @v_88214.mp4\n"}<span className="c">{"# 3. start the analysis; the decision arrives by webhook"}</span>{"\ncurl -X POST $QX/v1/videos/$ID/complete -H "}<span className="s">{"\"Authorization: Bearer $QUELLIX_API_KEY\""}</span></Fragment>,
              ]}
            />{" "}</div></div></section>{" "}
      <section className="sec" id="endpoints">
        <div className="wrap">{" "}
          <h2>Endpoints</h2>{" "}
          <div className="tw">
            <table>
              <thead>
                <tr>
                  <th>Endpoint</th>
                  <th>Does</th></tr></thead>
              <tbody>{" "}
                <tr>
                  <td>
                    <span className="mth p">POST</span>
                    <code>/v1/videos</code></td>
                  <td>{"Register a video and get a signed upload URL. Optional "}
                    <code>external_id</code>{", "}
                    <code>contributor_ref</code>{", "}
                    <code>lab_outcome</code>.</td></tr>{" "}
                <tr>
                  <td>
                    <span className="mth g">GET</span>
                    <code>/v1/videos</code></td>
                  <td>List videos, newest first. Filter by status and decision; cursor pagination.</td></tr>{" "}
                <tr>
                  <td>
                    <span className="mth g">GET</span>
                    <code>{"/v1/videos/{id}"}</code></td>
                  <td>A video with its decision, review and lab outcome.</td></tr>{" "}
                <tr>
                  <td>
                    <span className="mth p">POST</span>
                    <code>{"/v1/videos/{id}/complete"}</code></td>
                  <td>Mark the upload finished and queue the analysis.</td></tr>{" "}
                <tr>
                  <td>
                    <span className="mth p">POST</span>
                    <code>{"/v1/videos/{id}/review"}</code></td>
                  <td>A reviewer’s final decision, with an optional note.</td></tr>{" "}
                <tr>
                  <td>
                    <span className="mth p">POST</span>
                    <code>{"/v1/videos/{id}/lab-outcome"}</code></td>
                  <td>What the lab decided, used to measure precision.</td></tr>{" "}
                <tr>
                  <td>
                    <span className="mth g">GET</span>
                    <code>/v1/rubrics</code></td>
                  <td>List rubrics, latest version of each.</td></tr>{" "}
                <tr>
                  <td>
                    <span className="mth p">POST</span>
                    <code>/v1/rubrics</code></td>
                  <td>Create a rubric (version 1).</td></tr>{" "}
                <tr>
                  <td>
                    <span className="mth u">PUT</span>
                    <code>{"/v1/rubrics/{id}"}</code></td>
                  <td>Save a new version. Old versions are kept.</td></tr>{" "}</tbody></table></div>{" "}
          <p className="note">{"Authentication: "}
            <code>Authorization: Bearer qx_live_…</code>. We store only a hash of each key.</p>{" "}</div></section>{" "}
      <section className="sec" id="decision">
        <div className="wrap">{" "}
          <h2>The decision object</h2>{" "}
          <p className="lead">Every decision carries the result, the reasons, every measurement and the rubric version. Reason codes are stable; messages are written for people.</p>{" "}
          <div className="code" style={{ marginTop: "40px" }}>
            <pre>{"{\n  "}<span className="k">{"\"video_id\""}</span>{": "}<span className="s">{"\"v_88214\""}</span>{",\n  "}<span className="k">{"\"decision\""}</span>{": "}<span className="n">{"\"reject\""}</span>{",\n  "}<span className="k">{"\"reasons\""}</span>{": [{\n    "}<span className="k">{"\"check\""}</span>{": "}<span className="s">{"\"hands_visible\""}</span>{",\n    "}<span className="k">{"\"code\""}</span>{": "}<span className="s">{"\"hands_visible.below_min\""}</span>{",\n    "}<span className="k">{"\"message\""}</span>{": "}<span className="s">{"\"Both hands were visible 61% of the time while handling objects (minimum 80%).\""}</span>{",\n    "}<span className="k">{"\"effect\""}</span>{": "}<span className="n">{"\"reject\""}</span>{"\n  }],\n  "}<span className="k">{"\"checks\""}</span>{": {\n    "}<span className="k">{"\"hands_visible\""}</span>{": { "}<span className="k">{"\"status\""}</span>{": "}<span className="n">{"\"fail\""}</span>{", "}<span className="k">{"\"measurements\""}</span>{": { "}<span className="k">{"\"both_visible_ratio\""}</span>{": "}<span className="s">{"0.61"}</span>{" } },\n    "}<span className="k">{"\"task_completed\""}</span>{": { "}<span className="k">{"\"status\""}</span>{": "}<span className="o">{"\"pass\""}</span>{", "}<span className="k">{"\"measurements\""}</span>{": { "}<span className="k">{"\"confidence\""}</span>{": "}<span className="s">{"0.88"}</span>{" } }\n  },\n  "}<span className="k">{"\"rubric\""}</span>{": { "}<span className="k">{"\"id\""}</span>{": "}<span className="s">{"\"rub_load_dishwasher\""}</span>{", "}<span className="k">{"\"version\""}</span>{": "}<span className="s">{"3"}</span>{" },\n  "}<span className="k">{"\"engine_version\""}</span>{": "}<span className="s">{"\"0.1.0\""}</span>{"\n}"}</pre></div>{" "}</div></section>{" "}
      <section className="sec" id="webhooks">
        <div className="wrap">{" "}
          <h2>Webhooks</h2>{" "}
          <p className="lead">
            <code className="x-t">video.decided</code>{" is sent when a decision is ready. Each request is signed with your webhook secret."}</p>{" "}
          <div className="dual">{" "}
            <div className="code">
              <pre><span className="c">{"Quellix-Signature: t=1761062400,v1=5f2b\u2026c9"}</span>{"\n\n"}<span className="c">{"// v1 = HMAC-SHA256(secret, `${t}.${rawBody}`)"}</span>{"\n"}<span className="k">{"import"}</span>{" { verifySignature } "}<span className="k">{"from"}</span>{" "}<span className="s">{"\"@quellix/sdk\""}</span>{";\n\n"}<span className="k">{"const"}</span>{" ok = "}<span className="k">{"await"}</span>{" verifySignature(rawBody,\n  req.headers["}<span className="s">{"\"quellix-signature\""}</span>{"], secret);\n"}<span className="k">{"if"}</span>{" (!ok) "}<span className="k">{"return"}</span>{" res.status("}<span className="n">{"400"}</span>{").end();"}</pre></div>{" "}
            <div className="frd">{" "}
              <div>
                <h3>Verify every request</h3>
                <p>Compare in constant time and reject timestamps older than five minutes. Both SDKs do this for you.</p></div>{" "}
              <div>
                <h3>Respond fast</h3>
                <p>{"Return any 2xx, then process. The decision is also available by "}
                  <code>GET</code>, so a missed webhook never loses a result.</p></div>{" "}
              <div>
                <h3>Secret shown once</h3>
                <p>Create the webhook in Settings; the signing secret is shown one time.</p></div>{" "}</div></div>{" "}</div></section>{" "}
      <section className="sec" id="errors">
        <div className="wrap">{" "}
          <h2>Errors and limits</h2>{" "}
          <div className="tw">
            <table>
              <thead>
                <tr>
                  <th>Status</th>
                  <th>Meaning</th>
                  <th>SDK</th></tr></thead>
              <tbody>{" "}
                <tr>
                  <td>
                    <code>400</code></td>
                  <td>Invalid input; the body names the field</td>
                  <td>
                    <code>ValidationError</code></td></tr>{" "}
                <tr>
                  <td>
                    <code>401</code></td>
                  <td>Missing or revoked API key</td>
                  <td>
                    <code>AuthenticationError</code></td></tr>{" "}
                <tr>
                  <td>
                    <code>404</code></td>
                  <td>Unknown video or rubric in your organisation</td>
                  <td>
                    <code>NotFoundError</code></td></tr>{" "}
                <tr>
                  <td>
                    <code>429</code></td>
                  <td>{"Too many requests; honour "}
                    <code>Retry-After</code></td>
                  <td>
                    <code>RateLimitError</code>, retried automatically</td></tr>{" "}
                <tr>
                  <td>
                    <code>5xx</code></td>
                  <td>Our side; safe to retry</td>
                  <td>Retried with backoff</td></tr>{" "}</tbody></table></div>{" "}
          <p className="note">{"Files: MP4, QuickTime or WebM, up to 5 GB. Creates accept an "}
            <code>Idempotency-Key</code>{" header."}</p>{" "}</div></section>{" "}
      <section className="end" id="start">
        <div className="glow" aria-hidden="true"></div>{" "}
        <div className="z">
          <h2>Ship it this afternoon.</h2>
          <p>Create a key, send one video and read the decision. The pilot is free.</p>{" "}
          <div className="cta">
            <Link className="b w" href="/signup">Start a free pilot</Link>
            <Link className="b o" href="/developers">Read the API</Link></div></div>{" "}
        <SiteFooter />{" "}
        <p className="note" style={{ padding: "0 16px 28px" }}>Demo footage on this site: Build AI Egocentric-10K, Apache 2.0.</p>{" "}</section>{" "}
    </main>
  );
}
