// Generated from docs/design/site/security.html (issue #35). Keep the copy and structure in step with the design.
import Link from "next/link";
import { SiteFooter } from "./site-footer";

export function SecurityPage() {
  return (
    <main>{" "}
      <section className="ph1">
        <div className="hc">{" "}
          <div className="eyebrow">Security and data</div>{" "}
          <h1>Videos are checked, not kept.</h1>{" "}
          <p className="hl">What happens to a video from upload to deletion, what we keep, and who processes it.</p>{" "}
          <nav className="toc" aria-label="On this page">
            <a href="#life">Lifecycle</a>
            <a href="#keep">What we keep</a>
            <a href="#models">Models and training</a>
            <a href="#isolation">Isolation</a>
            <a href="#providers">Providers</a></nav>{" "}</div></section>{" "}
      <section className="sec" id="life">
        <div className="wrap">{" "}
          <h2>The life of a video</h2>{" "}
          <ol className="life">{" "}
            <li>
              <small>Upload</small>
              <h3>Private storage</h3>
              <p>The file goes to a private bucket through a signed URL that expires. No public link exists.</p></li>{" "}
            <li>
              <small>Analysis</small>
              <h3>Checked once</h3>
              <p>The worker downloads it, runs the checks and writes the decision.</p></li>{" "}
            <li>
              <small>Decision</small>
              <h3>Deleted</h3>
              <p>Accepted and rejected videos are deleted right after the decision. Failed analyses too, after the last retry.</p></li>{" "}
            <li>
              <small>Review</small>
              <h3>14 days at most</h3>
              <p>Videos waiting for a reviewer are kept until a person decides, and never longer than 14 days.</p></li>{" "}</ol>{" "}</div></section>{" "}
      <section className="sec" id="keep">
        <div className="wrap">{" "}
          <h2>What we keep, and what we don’t.</h2>{" "}
          <div className="car" style={{ marginTop: "56px" }}>{" "}
            <div className="cd">
              <h3>Kept, per customer</h3>
              <ul className="ls y">
                <li>Decisions, reasons and every measurement</li>
                <li>The rubric version each decision used</li>
                <li>Reviewer decisions and notes</li>
                <li>Your lab’s outcomes</li>
                <li>Fingerprints that can’t be turned back into video</li></ul></div>{" "}
            <div className="cd">
              <h3>Not kept</h3>
              <ul className="ls n">
                <li>The video, after the analysis</li>
                <li>Contributor names, emails or payment details: only your opaque id</li>
                <li>Anything visible to another customer</li></ul></div>{" "}</div></div></section>{" "}
      <section className="sec" id="models">
        <div className="wrap">{" "}
          <h2>Models and training</h2>{" "}
          <div className="rows">{" "}
            <div className="rw">
              <h3>No training without opt-in.</h3>
              <p>Your videos train nothing unless you turn on training in Settings. If you do, they train Ormes’s own models only, and you pay less.</p></div>{" "}
            <div className="rw">
              <h3>No third-party models by default.</h3>
              <p>Customer video is never sent to an external model provider unless your organisation enables it. It is off by default.</p></div>{" "}
            <div className="rw">
              <h3>Never resold.</h3>
              <p>We don’t sell, share or offer your videos or measurements to labs or anyone else.</p></div>{" "}
            <div className="rw">
              <h3>A DPA for everyone.</h3>
              <p>A data processing agreement is included for every customer.</p></div>{" "}</div></div></section>{" "}
      <section className="sec" id="isolation">
        <div className="wrap">{" "}
          <h2>Isolation and keys</h2>{" "}
          <div className="caps" style={{ marginTop: "40px" }}>{" "}
            <div>
              <h3>Per-organisation access</h3>
              <p>Every table is protected by row-level security on your organisation. Duplicate matching never looks across customers.</p></div>{" "}
            <div>
              <h3>Keys stored as hashes</h3>
              <p>API keys and webhook secrets are shown once. We keep only a hash of each API key.</p></div>{" "}
            <div>
              <h3>Signed webhooks</h3>
              <p>HMAC-SHA256 with a timestamp, so you can reject forged or replayed requests.</p></div>{" "}</div></div></section>{" "}
      <section className="sec" id="providers">
        <div className="wrap">{" "}
          <h2>Who processes your data</h2>{" "}
          <div className="tw">
            <table>
              <thead>
                <tr>
                  <th>Provider</th>
                  <th>Purpose</th>
                  <th>Data</th></tr></thead>
              <tbody>{" "}
                <tr>
                  <td>Supabase</td>
                  <td>Database, private file storage, sign-in</td>
                  <td>Account data, decisions, videos until deletion. Region: EU (Stockholm)</td></tr>{" "}
                <tr>
                  <td>Vercel</td>
                  <td>Web app and API</td>
                  <td>Requests and account data; videos are uploaded directly to storage</td></tr>{" "}
                <tr>
                  <td>Modal</td>
                  <td>Video analysis compute</td>
                  <td>Videos during analysis only</td></tr>{" "}
                <tr>
                  <td>Google (Gemini)</td>
                  <td>Fallback model, only if your organisation enables external models</td>
                  <td>Videos you allow, during analysis</td></tr>{" "}</tbody></table></div>{" "}</div></section>{" "}
      <section className="end" id="start">
        <div className="glow" aria-hidden="true"></div>{" "}
        <div className="z">
          <h2>Questions from your security team?</h2>
          <p>We answer them in writing, with the DPA. Start with a pilot on videos you already own.</p>{" "}
          <div className="cta">
            <Link className="b w" href="/signup">Start a free pilot</Link>
            <Link className="b o" href="/developers">Read the API</Link></div></div>{" "}
        <SiteFooter />{" "}
        </section>{" "}
    </main>
  );
}
