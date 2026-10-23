import Link from "next/link";
import { LandingEffects } from "./landing-effects";
import "./landing.css";

/*
 * Home, v4: designed with the founder in an artifact and ported as is.
 * Three section types only: showcase (one big visual), statement (big type, no visual), detail (quiet text).
 * Dark opening (hero + problem), a calm white body, dark close (developers + CTA + footer).
 * Hero clip is a placeholder until the founder picks the hero video (#84).
 */

const FAQ = [
  {
    q: "We already check uploads. Why Ormes?",
    a: "Upload checks catch technical problems. The expensive calls are hands, steps and privacy, which today need a person. Ormes makes those calls with reasons and sends only the doubtful ones to your reviewers.",
  },
  {
    q: "Why not prompt a general video model?",
    a: "On our benchmark with independent labels, general models reject far more good videos than Ormes does. Ormes uses its own models for hands and tasks, and sends doubtful cases to review.",
  },
  { q: "Who sets the criteria?", a: "You, from your lab’s spec. Each task has its own rubric, and every decision records the rubric version it used." },
  {
    q: "How accurate is it?",
    a: "We report precision and recall on rejections against your own reject rate, on videos your reviewers or your lab have already judged. That is the pilot report.",
  },
  {
    q: "Does Ormes keep my videos?",
    a: "No. Videos are deleted after analysis; those waiting for review within 14 days. We keep decisions, reasons and measurements so you have a record of every call.",
  },
  {
    q: "Can Ormes reject a good video?",
    a: "It sends doubtful cases to review, never a silent reject. A reject needs a clear measurement against your rubric, and a contributor can always contest it with a person.",
  },
];

const CHECKS = [
  ["Hands on the work", "Both hands visible while they handle objects."],
  ["Task completed", "Every step found in order, final state checked."],
  ["Privacy", "Faces, readable documents and screens, with their times."],
  ["First-person", "Camera on the head or chest, not on a tripod."],
  ["Already delivered", "Re-uploads and edited copies of earlier videos."],
  ["Technical", "Duration, resolution, frame rate, blur and light."],
];

const CODE = [
  '<span class="k">import</span> { Ormes } <span class="k">from</span> <span class="s">"@ormes/sdk"</span>;',
  "",
  '<span class="k">const</span> ormes = <span class="k">new</span> Ormes(); <span class="c">// reads ORMES_API_KEY</span>',
  "",
  '<span class="k">const</span> video = <span class="k">await</span> ormes.videos.upload(file, { rubric_id });',
  '<span class="k">const</span> { decision } = <span class="k">await</span> ormes.videos.waitForDecision(video.id);',
  "",
  '<span class="c">// "accept" | "review" | "reject", with every reason</span>',
].join("\n");

export function Landing() {
  return (
    <div className="ormes-landing">
      <LandingEffects />
      <header className="nav">
        <div className="wrap">
          <Link className="logo" href="/">
            <i />
            ORMES
          </Link>
          <ul>
            <li><Link href="/product">Product</Link></li>
            <li><Link href="/security">Security</Link></li>
            <li><Link href="/docs">Docs</Link></li>
          </ul>
          <div className="actions">
            <Link className="link" href="/login">Sign in ↗</Link>
            <Link className="btn" href="/signup">Start a pilot</Link>
          </div>
        </div>
      </header>

      <main id="top">
        {/* 1. Hero: showcase, dark */}
        <section className="hero dark">
          <div className="wrap">
            <h1>Stop watching every video before you pay for it.</h1>
            <p className="lede">
              Ormes applies your lab’s spec to every first-person video and decides accept, reject or review. Hands on the work, every
              step done, nothing private in view.
            </p>
            <div className="ctas">
              <Link className="btn btn-light" href="/signup">Start a free pilot ↗</Link>
              <a className="btn btn-ghost" href="#product">See how it decides ↗</a>
            </div>
          </div>
          <div className="stage-wrap">
            <div className="scene" aria-label="Ormes analysing a first-person video of someone cutting a lemon">
              <div className="portrait">
                <video muted autoPlay loop playsInline poster="/media/clips/hero-lemons.jpg" data-sidecar="/media/clips/hero-lemons.json" data-pos-y="0.88">
                  <source src="/media/clips/hero-lemons.webm" type="video/webm" />
                  <source src="/media/clips/hero-lemons.mp4" type="video/mp4" />
                </video>
                <div className="scan" />
                <div className="box" data-side="left" style={{ opacity: 0 }} />
                <div className="box" data-side="right" style={{ opacity: 0 }} />
                <span className="status" data-clock>analysing · 0:00 / 0:08</span>
              </div>
            </div>
          </div>
        </section>

        {/* 2. Problem: statement, dark */}
        <section className="problem dark">
          <div className="wrap grid">
            <div className="big">
              320<small>videos still waiting at 17:00, on a day with 480 uploads.</small>
            </div>
            <div>
              <p className="say">
                One reviewer watches about 160 a day, three minutes each. <span>The rest wait, and so do the people who filmed them.</span>
              </p>
              <p className="foot">Example day for one reviewer. Feedback today takes about 3 days (Market Xcel case study).</p>
            </div>
          </div>
        </section>

        {/* 3. Product: showcase, white */}
        <section className="product" id="product">
          <div className="wrap">
            <div className="head">
              <h2 className="h2">One video. One decision. One reason.</h2>
              <p className="sub lede">Ormes watches the whole video against your rubric and tells you what it found, and when.</p>
            </div>
            <div className="panel">
              <div className="media">
                <video
                  id="pv"
                  src="/media/clips/clip-03.mp4"
                  poster="/media/clips/clip-03.jpg"
                  autoPlay
                  muted
                  loop
                  playsInline
                  aria-label="Whipping cream with one hand in view"
                />
                <div className="timeline" aria-hidden="true">
                  <b />
                  <i className="head-pos" id="ph" />
                </div>
              </div>
              <div className="read">
                <span className="label">Decision</span>
                <span className="decision">review</span>
                <p className="reason">Both hands visible 0% of the time during manipulation (minimum 60%).</p>
                <p className="when">0:00 – 0:09 · hands_visible</p>
                <p className="hint">
                  <strong>Hint for the contributor:</strong> keep both hands in frame while you work. Hold the camera a little lower and keep
                  your hands in front of you.
                </p>
                <p className="note">Ormes’s real output for this clip, unedited.</p>
              </div>
            </div>
          </div>
        </section>

        <hr className="divider" />

        {/* 4. Numbers: statement */}
        <section className="numbers">
          <div className="wrap">
            <p className="line">
              10,000 videos a month. <em>Your reviewers watch 1,500.</em>
            </p>
            <div className="split">
              <div><strong>8,000</strong><span>accepted with every check passed</span></div>
              <div><strong>1,500</strong><span>sent to a person, with the moment to look at</span></div>
              <div><strong>500</strong><span>rejected with a reason</span></div>
              <div><strong>500 h → 75 h</strong><span>review time, at 3 minutes a video</span></div>
            </div>
          </div>
        </section>

        <hr className="divider" />

        {/* 5. Checks: detail */}
        <section className="checks">
          <div className="wrap">
            <h2 className="h2">What it checks, on every video.</h2>
            <p className="sub lede">Each check returns a measurement and the moments it found. Your rubric decides what rejects.</p>
            <div className="rows">
              {CHECKS.map(([title, text]) => (
                <div className="row" key={title}>
                  <h3>{title}</h3>
                  <p>{text}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <hr className="divider" />

        {/* 6. Why: statement */}
        <section className="why">
          <div className="wrap">
            <h2 className="h2">A reason they can fix, in seconds.</h2>
            <div className="quotes">
              <div className="q before">
                <span className="who">TODAY · THE NEXT DAY</span>
                <blockquote>“Your video was rejected.”</blockquote>
              </div>
              <div className="q">
                <span className="who">WITH ORMES · SECONDS AFTER UPLOAD</span>
                <blockquote>“Rejected at 0:02: too dark 35% of the time.”</blockquote>
                <p className="after-hint">Film in even light: avoid dark rooms and pointing the camera at windows or lamps.</p>
              </div>
            </div>
          </div>
        </section>

        <hr className="divider" />

        {/* 7. Privacy: detail */}
        <section id="privacy">
          <div className="wrap">
            <h2 className="h2">Videos are checked, not kept.</h2>
            <p className="sub lede">We keep the decision, its reasons and measurements. Not the video.</p>
            <div className="facts">
              <div><h3>Deleted after analysis</h3><p>Each video is deleted once it has its decision.</p></div>
              <div><h3>Review videos: 14 days at most</h3><p>Kept only until a person decides, then deleted anyway.</p></div>
              <div><h3>Never used for training</h3><p>Unless you opt in. Never shown to another customer.</p></div>
            </div>
            <Link className="textlink" href="/security">How your videos are handled →</Link>
          </div>
        </section>

        <hr className="divider" />

        {/* 8. Pilot: detail */}
        <section id="pilot">
          <div className="wrap">
            <h2 className="h2">Try it on videos you already judged.</h2>
            <p className="sub lede">Free, in shadow mode: no integration, a report in 48 hours, against criteria agreed first.</p>
            <div className="steps">
              <div><h3>Agree on success</h3><p>What a good result means for you, written down first.</p></div>
              <div><h3>Send about 50 videos</h3><p>Already judged by your reviewers, with the lab’s spec.</p></div>
              <div><h3>Shadow mode</h3><p>Ormes decides next to your reviewers. No integration.</p></div>
              <div><h3>Report in 48 h</h3><p>Where it agreed, where it didn’t, the hours it saves.</p></div>
            </div>
            <div className="criteria">
              <span>
                Example criteria: review minutes down 40% or more · no more false accepts than today · every reject has a reason your
                reviewers agree with
              </span>
            </div>
          </div>
        </section>

        <hr className="divider" />

        {/* 9. FAQ: detail */}
        <section>
          <div className="wrap faq">
            <h2 className="h2">Questions</h2>
            <div>
              {FAQ.map((f) => (
                <details key={f.q}>
                  <summary>{f.q}</summary>
                  <p>{f.a}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        {/* 10. Developers: dark, joined to the CTA */}
        <section className="devs dark" id="developers">
          <div className="wrap grid">
            <div>
              <h2 className="h2">One call where you approve videos today.</h2>
              <ol>
                <li>Write the rubric<span>Once per task, from your lab’s spec.</span></li>
                <li>Send each upload<span>One SDK call in TypeScript or Python.</span></li>
                <li>Act on the decision<span>Signed webhook or polling, with every reason.</span></li>
              </ol>
            </div>
            <div className="code">
              <div className="bar">upload.ts</div>
              <pre dangerouslySetInnerHTML={{ __html: CODE }} />
            </div>
          </div>
        </section>

        <section className="cta dark">
          <div className="wrap">
            <h2>Every video you pay for teaches a robot.</h2>
            <p className="sub">Make sure it teaches the right thing. Send videos your reviewers have already judged and see the report.</p>
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
