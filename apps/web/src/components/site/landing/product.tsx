import Link from "next/link";
import { LandingEffects } from "./landing-effects";
import { SiteNav } from "./site-nav";
import "./landing.css";

/*
 * Product, v2: designed with the founder in an artifact, same system as Home v4 (showcase / statement / detail,
 * white body, dark close). The dough clip is a still image until its video and hand boxes are committed (#87).
 */

const CHECKS: [string, string, string, string][] = [
  ["Hands on the work", "Share of handling time with each hand in frame, and when a hand is cut", "Minimum share, both hands or one", "review below 80%"],
  ["Task completed", "Each step found in order, final state reached", "Steps, final state, minimum confidence", "reject, critical"],
  ["Privacy", "Faces, readable documents and screens, with time and size", "Reject, review or ignore, per kind", "review"],
  ["First-person", "Camera on the head or chest, or on a tripod", "Required viewpoint", "review if not first-person"],
  ["Already delivered", "Similarity to your earlier videos, edited copies included", "Threshold, reject or review", "reject above 0.90"],
  ["Framing", "Time pointed away from the work, unstable time", "Maximum share of each", "review above 10%"],
  ["Technical", "Duration, resolution, frame rate, blur and light", "Minimums and maximums", "reject, critical"],
];

const SPEC: [string, string][] = [
  ["“Both hands must be visible at least 80% of the time while handling objects.”", "hands ≥ 80%"],
  ["“Minimum 1080p at 30 fps.”", "1920×1080 · 30 fps"],
  ["“No faces of other people.”", "faces: reject"],
  ["“Camera mounted on the head.”", "first-person"],
];

export function Product() {
  return (
    <div className="ormes-landing">
      <LandingEffects />
      <SiteNav current="/product" />

      <main id="top">
        {/* Intro: no hero, just what the page explains */}
        <section className="p-intro dark">
          <div className="wrap">
            <h1>How Ormes decides.</h1>
            <p className="lede">
              What each check measures, how your rubric turns it into a decision, and what happens after: review, contests and your
              lab’s results.
            </p>
            <nav aria-label="On this page">
              <a href="#decision">A decision</a>
              <a href="#rule">The rule</a>
              <a href="#checks">Checks</a>
              <a href="#rubric">Rubrics</a>
              <a href="#review">Review</a>
              <a href="#contest">Contests</a>
              <a href="#results">Results</a>
            </nav>
          </div>
        </section>

        {/* 1. One real decision: showcase */}
        <section id="decision">
          <div className="wrap">
            <div className="head">
              <h2 className="h2">One video, one decision.</h2>
              <p className="sub lede">Ormes follows the hands for the whole video, checks every rule in your rubric, and gives one answer with its reasons.</p>
            </div>
            <div className="panel">
              <div className="media">
                <video muted autoPlay loop playsInline poster="/media/clips/product-dough.jpg" data-sidecar="/media/clips/product-dough.json" data-pos-y="0.5" aria-label="Kneading dough on a checked tablecloth, filmed first-person">
                  <source src="/media/clips/product-dough.webm" type="video/webm" />
                  <source src="/media/clips/product-dough.mp4" type="video/mp4" />
                </video>
                <div className="box" data-side="left" style={{ opacity: 0 }} />
                <div className="box" data-side="right" style={{ opacity: 0 }} />
              </div>
              <div className="read">
                <span className="label">Decision</span>
                <span className="decision acc">accept</span>
                <p className="reason">Every check passed.</p>
                <p className="when">both hands in view 82% · first-person · light even · no faces</p>
                <p className="hint">
                  <strong>If a hand leaves the frame,</strong> the same video goes to review, with the moment and a hint for the contributor.
                </p>
                <p className="note">Ormes’s real output for this clip, unedited.</p>
              </div>
            </div>
          </div>
        </section>

        <hr className="divider" />

        {/* 2. The rule: detail */}
        <section id="rule">
          <div className="wrap">
            <h2 className="h2">Measure, compare, decide.</h2>
            <div className="flow3">
              <div><span className="n">1</span><h3>Each check measures</h3><p>Hands in view, steps found, faces, light, camera position. Numbers and moments, no opinions.</p></div>
              <div><span className="n">2</span><h3>Your rubric sets the limits</h3><p>From your lab’s spec: what is critical, what is only worth a look, what to ignore.</p></div>
              <div><span className="n">3</span><h3>Ormes decides</h3><p>Every reason carries its measurement and its moment, so anyone can check the call.</p></div>
            </div>
            <div className="outcomes">
              <span><span className="decision acc">accept</span> every check passed</span>
              <span><span className="decision rev">review</span> a doubt, or a non-critical failure</span>
              <span><span className="decision rej">reject</span> a critical failure with a clear measurement</span>
            </div>
          </div>
        </section>

        <hr className="divider" />

        {/* 3. Checks: detail table */}
        <section id="checks">
          <div className="wrap">
            <h2 className="h2">Every check, and what you set.</h2>
            <p className="sub lede">Each check can be critical, not critical, or turned off.</p>
            <div className="tbl">
              <table>
                <thead>
                  <tr><th>CHECK</th><th>MEASURES</th><th>YOU SET</th><th>DEFAULT</th></tr>
                </thead>
                <tbody>
                  {CHECKS.map(([c, m, s, d]) => (
                    <tr key={c}><td>{c}</td><td>{m}</td><td>{s}</td><td>{d}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        <hr className="divider" />

        {/* 4. Rubrics: detail with one quiet visual */}
        <section id="rubric">
          <div className="wrap two">
            <div>
              <h2 className="h2">Your lab’s spec, as a rubric.</h2>
              <p className="sub lede">Paste the guidelines or drop the PDF. Ormes drafts the rubric and shows the line each value came from.</p>
              <ul>
                <li><b>Every value is cited.</b> What the spec doesn’t say keeps the default.</li>
                <li><b>Nothing is dropped.</b> Requirements Ormes can’t check yet are listed.</li>
                <li><b>Every save is a new version.</b> Old decisions keep the version they used.</li>
              </ul>
            </div>
            <div className="spec" aria-label="Example of a spec turned into rubric values">
              <div className="head"><span>lab-spec.pdf → rubric v1</span><span>example</span></div>
              {SPEC.map(([q, c]) => (
                <div className="line" key={c}><q>{q}</q><code>{c}</code></div>
              ))}
            </div>
          </div>
        </section>

        <hr className="divider" />

        {/* 5. Review: showcase */}
        <section id="review">
          <div className="wrap">
            <div className="head">
              <h2 className="h2">Your reviewers watch seconds, not minutes.</h2>
              <p className="sub lede">Only doubtful videos reach a person, and each one opens at the moment that needs a look.</p>
            </div>
            <div className="rv" style={{ marginTop: "clamp(28px, 5vh, 48px)" }}>
              <div className="media">
                <video muted autoPlay loop playsInline poster="/media/clips/product-dough-hand.jpg" data-sidecar="/media/clips/product-dough-hand.json" data-pos-y="0.5" data-flag="1.75-6.01,7.26-7.51,8.51-8.59" aria-label="The same video with one hand leaving the frame">
                  <source src="/media/clips/product-dough-hand.webm" type="video/webm" />
                  <source src="/media/clips/product-dough-hand.mp4" type="video/mp4" />
                </video>
                <div className="box" data-side="left" style={{ opacity: 0 }} />
                <div className="box" data-side="right" style={{ opacity: 0 }} />
              </div>
              <div className="side">
                <span className="label">To check · review</span>
                <div className="mom"><p className="when">0:01 – 0:06 · hands_visible</p><p>Both hands visible 57% of the time during manipulation, just under the minimum (60%).</p></div>
                <p className="note" style={{ color: "var(--muted)", fontSize: 14 }}>Ormes’s real output for this copy, where one hand leaves the frame. Everything else passed.</p>
                <div className="acts"><span className="on">Accept</span><span>Reject</span></div>
              </div>
            </div>
          </div>
        </section>

        <hr className="divider" />

        {/* 6. Contests: detail */}
        <section id="contest">
          <div className="wrap">
            <h2 className="h2">A contributor can always ask a person.</h2>
            <p className="sub lede">Contributors see the reason, the moment and how to fix it. If they disagree, they contest from a link.</p>
            <div className="facts">
              <div><h3>They see why</h3><p>The reason and the hint, never internal signals such as duplicate matching.</p></div>
              <div><h3>A person decides</h3><p>Someone on your team upholds or overturns it, with a note kept on the decision.</p></div>
              <div><h3>Mistakes count</h3><p>An overturned rejection counts against Ormes in your precision report.</p></div>
            </div>
          </div>
        </section>

        <hr className="divider" />

        {/* 7. Results: statement */}
        <section id="results">
          <div className="wrap stat">
            <div className="big">91%<small>of Ormes rejections were right on our benchmark.</small></div>
            <div>
              <p className="say" style={{ fontSize: "clamp(22px,2.4vw,30px)", lineHeight: 1.25, maxWidth: "28ch" }}>
                General video models: 57–70%. Your pilot report measures the same thing on your own videos, against your lab’s decisions.
              </p>
              <p className="foot" style={{ color: "var(--muted)" }}>Benchmark v2: 379 clips with independent labels (HoloAssist), October 2026.</p>
            </div>
          </div>
        </section>

        <section className="cta dark">
          <div className="wrap">
            <h2>See it on your own videos.</h2>
            <p className="sub">Send a batch your reviewers have already judged. We return the decisions and a report of the hours saved.</p>
            <div className="ctas">
              <Link className="btn btn-light" href="/signup">Start a free pilot</Link>
              <Link className="btn btn-ghost" href="/docs">Read the docs</Link>
            </div>
          </div>
        </section>
      </main>

      <footer className="dark">
        <div className="wrap">
          <span>Ormes</span>
          <nav>
            <Link href="/data">Data handling</Link>
            <Link href="/dpa">DPA</Link>
            <Link href="/docs">Docs</Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}
