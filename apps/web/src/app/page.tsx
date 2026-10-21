import type { CSSProperties } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { HeroCanvas } from "@/components/landing/hero-canvas";
import { LandingNav } from "@/components/landing/landing-nav";
import "@/components/landing/landing.css";

export const metadata: Metadata = { title: { absolute: "Quellix" } };

const cols = (n: number) => ({ "--cols": n }) as CSSProperties;

// Ported from docs/design/landing-reference.html; keep the two in step.
export default function Landing() {
  return (
    <div className="lp">
      <LandingNav />

      <main>
        <section className="hero" id="top">
          <div className="hc">
            <h1>Stop watching every video before you pay for it.</h1>
            <p className="hl">
              Quellix applies your lab’s spec to every upload and decides accept, reject or review. Your reviewers only see the
              doubtful cases.
            </p>
            <div className="hb">
              <a className="b w" href="#start">
                Request a demo
              </a>
              <a className="b o" href="#steps">
                How it works
              </a>
            </div>
            <div className="vis">
              <div className="scr">
                <HeroCanvas />
                <div className="hud" aria-hidden="true">
                  <span className="rc">
                    <i />
                    REC 00:24
                  </span>
                  <span>load the dishwasher</span>
                </div>
              </div>
              <div className="ov">
                <div className="ovh">
                  <span>v_88213</span>
                  <span className="x-t ok">accept</span>
                </div>
                <div className="x-fld">
                  <span>Task completed</span>
                  <span className="x-t">yes</span>
                </div>
                <div className="x-fld">
                  <span>Hands visible</span>
                  <span className="x-t b">92%</span>
                </div>
                <div className="x-fld">
                  <span>Personal data</span>
                  <span className="x-t">none</span>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="sec" id="steps">
          <div className="wrap">
            <h2>From upload to decision in three steps</h2>
            <p className="lead">One API call where you approve videos today. Recruiting, tasks and payouts stay yours.</p>
            <div className="body">
              <div className="car" style={cols(3)}>
                <div className="cd">
                  <div className="pn">
                    <div className="x-win">
                      <WindowBar title="rubric · load the dishwasher" />
                      <Field label="Task completed" value="required" tone="b" />
                      <Field label="Hands visible" value="min 80%" tone="b" />
                      <Field label="Blur" value="max 5%" />
                      <Field label="Faces or documents" value="review" />
                      <div className="x-note">Start from your buyer&apos;s spec. One rubric per task, versioned.</div>
                    </div>
                  </div>
                  <h3>
                    <b>1</b>Set the rubric
                  </h3>
                  <p>Write down what an acceptable video looks like for each task, the same way your buyer does.</p>
                </div>
                <div className="cd">
                  <div className="pn">
                    <div className="x-win">
                      <WindowBar title="video v_88214" />
                      <Field label="Decision" value="reject" tone="no" />
                      <Field label="Task completed" value="00:03–00:31" />
                      <Field label="Hands visible" value="61%" tone="no" />
                      <Field label="Blur" value="2%" />
                      <Field label="Already delivered" value="no" />
                    </div>
                  </div>
                  <h3>
                    <b>2</b>Check every upload
                  </h3>
                  <p>Each video comes back with a decision and the reasons behind it, in under a minute.</p>
                </div>
                <div className="cd">
                  <div className="pn">
                    <div className="x-win">
                      <WindowBar title="review queue" />
                      <div className="x-code">
                        <span className="t">v_88217</span>{"  "}<span className="s">face at 00:12</span>
                        {"\n"}
                        <span className="t">v_88221</span>{"  "}<span className="s">task ends early</span>
                        {"\n"}
                        <span className="t">v_88230</span>{"  "}<span className="s">document on table</span>
                        {"\n"}
                        <span className="k">auto-decided</span>{"   "}<span className="t">87% of today</span>
                        {"\n"}
                        <span className="k">lab outcomes</span>{"   "}<span className="t">in the report</span>
                      </div>
                      <div className="x-note">Your reviewers see only the doubtful cases.</div>
                    </div>
                  </div>
                  <h3>
                    <b>3</b>Review only the edge cases
                  </h3>
                  <p>Clear cases are decided for you. Doubtful ones come with the reason, for a person to decide.</p>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="sec" id="privacy">
          <div className="wrap">
            <h2>Videos are checked, not kept.</h2>
            <p className="lead">
              Quellix analyses each video, returns its decision and deletes it. Your videos are never used to train models, and
              every provider we use is listed.
            </p>
            <div className="body">
              <div className="flow">
                <div className="nd">
                  <small>Phone</small>
                  <h3>Contributor</h3>
                  <span className="x-g" style={{ width: "82%" }} />
                  <span className="x-g bl" style={{ width: "46%" }} />
                  <span className="x-g" style={{ width: "64%" }} />
                </div>
                <div className="ln" aria-hidden="true" />
                <div className="nd on">
                  <small>Cloud</small>
                  <h3>Quellix</h3>
                  <div className="tags">
                    <span className="x-t b">decision</span>
                    <span className="x-t b">reasons</span>
                    <span className="x-t b">hands %</span>
                    <span className="x-t b">fingerprint</span>
                  </div>
                </div>
                <div className="ln" aria-hidden="true" />
                <div className="nd">
                  <small>Your platform</small>
                  <h3>Pays and sells</h3>
                  <span className="x-g" style={{ width: "72%" }} />
                  <span className="x-g" style={{ width: "50%" }} />
                </div>
              </div>
              <div className="car">
                <div className="cd">
                  <h3>What Quellix keeps</h3>
                  <ul className="ls y">
                    <li>The decision and its reasons.</li>
                    <li>The measurement behind each check.</li>
                    <li>The rubric version that was used.</li>
                    <li>A fingerprint that can’t be turned back into video.</li>
                  </ul>
                </div>
                <div className="cd">
                  <h3>What it doesn’t</h3>
                  <ul className="ls n">
                    <li>The video, after the analysis.</li>
                    <li>Faces, documents and screens it flagged.</li>
                    <li>Contributor names and payment details.</li>
                    <li>Anything visible to other customers.</li>
                    <li>Training data for any model.</li>
                  </ul>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="sec" id="fraud">
          <div className="wrap">
            <h2>No video gets paid twice.</h2>
            <p className="lead">
              Re-uploads, edited copies and clips taken from the internet are caught before payment, in the same call as every
              other check.
            </p>
            <div className="body split">
              <div className="pn">
                <div className="x-win">
                  <WindowBar title="POST /v1/videos · response" />
                  <div className="x-code">
                    {"{\n  "}
                    <span className="k">&quot;video_id&quot;</span>: <span className="s">&quot;v_88240&quot;</span>,{"\n  "}
                    <span className="k">&quot;decision&quot;</span>: <span className="n">&quot;reject&quot;</span>,{"\n  "}
                    <span className="k">&quot;reason&quot;</span>: <span className="s">&quot;already_delivered&quot;</span>,{"\n  "}
                    <span className="k">&quot;detail&quot;</span>:{" "}
                    <span className="s">
                      &quot;same video delivered{"\n"}
                      {"             "}4 days ago as v_80102&quot;
                    </span>
                    ,{"\n  "}
                    <span className="k">&quot;similarity&quot;</span>: <span className="s">0.98</span>
                    {"\n}"}
                  </div>
                </div>
              </div>
              <div className="frd">
                <div>
                  <h3>Old videos uploaded again</h3>
                  <p>A recording that was already delivered can’t come back under a new name or a new task.</p>
                </div>
                <div>
                  <h3>Edited copies</h3>
                  <p>Cropped, mirrored, slowed down or re-compressed copies are matched too.</p>
                </div>
                <div>
                  <h3>Footage from the internet</h3>
                  <p>Clips downloaded from the web are flagged before anyone gets paid.</p>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="sec" id="limits">
          <div className="wrap">
            <h2>What Quellix doesn’t do.</h2>
            <div className="rows">
              <div className="rw">
                <h3>It doesn’t sell your data.</h3>
                <p>We check your videos and delete them. We don’t keep them and we don’t offer them to labs.</p>
              </div>
              <div className="rw">
                <h3>It doesn’t take the last word.</h3>
                <p>You set the rubric, your reviewers can override any decision, and contributors can contest a rejection with a person.</p>
              </div>
              <div className="rw">
                <h3>It doesn’t promise what your lab will accept.</h3>
                <p>It applies the spec you give it, the same way on every video. Upload your lab’s decisions and we measure ourselves against them.</p>
              </div>
              <div className="rw">
                <h3>First-person video comes first.</h3>
                <p>We start with egocentric video from phones and action cameras. Robot data and other sensors come later.</p>
              </div>
            </div>
            <p className="more">
              <a href="#faq">Read the FAQ →</a>
            </p>
          </div>
        </section>

        <section className="sec" id="pricing">
          <div className="wrap">
            <h2>Pay for the hours we check</h2>
            <p className="lead">
              Try it on your own videos first. Prices will be published here, with clear limits so the bill never surprises you.
            </p>
            <ul className="ck">
              <li>
                <b>Free pilot</b> on a sample of your videos
              </li>
              <li>
                <b>Usage-based</b>, per hour of video checked
              </li>
              <li>
                <b>Annual plans</b> for large volumes
              </li>
              <li>
                <b>DPA included</b>, for every customer
              </li>
            </ul>
            <div className="pcs">
              <div className="car">
                <div className="pk">
                  <span className="ph">Without Quellix</span>
                  <div className="pp2">500 h</div>
                  <div className="pe">of review per month, example</div>
                  <div className="calc">
                    <Row label="Videos received" value="10,000" />
                    <Row label="Videos a person watches" value="10,000" />
                    <Row label="Review time per video" value="3 min" />
                    <Row label="Review hours" value="500" className="neg" />
                  </div>
                  <ul className="ls n">
                    <li>Every video watched by a person</li>
                    <li>Each reviewer reads the spec their own way</li>
                  </ul>
                </div>
                <div className="pk on">
                  <span className="ph">With Quellix</span>
                  <div className="pp2">75 h</div>
                  <div className="pe">of review per month, example</div>
                  <div className="calc">
                    <Row label="Videos received" value="10,000" />
                    <Row label="Decided automatically" value="8,500" />
                    <Row label="Sent to review" value="1,500" />
                    <Row label="Review hours" value="75" className="tot" />
                  </div>
                  <ul className="ls y">
                    <li>Reviewers see only the doubtful cases</li>
                    <li>The same spec on every video, with reasons</li>
                  </ul>
                </div>
              </div>
              <p className="fine" style={{ marginTop: 14 }}>
                Example with hypothetical numbers: 10,000 videos a month, 3 minutes of review each, 15% sent to review. Quellix’s fee
                is not included.
              </p>
            </div>
          </div>
        </section>

        <section className="sec" id="faq">
          <div className="wrap">
            <h2>Questions</h2>
            <div className="faq">
              {FAQ.map(([q, a]) => (
                <details key={q}>
                  <summary>{q}</summary>
                  <p>{a}</p>
                </details>
              ))}
            </div>
          </div>
        </section>
      </main>

      <section className="end" id="start">
        <div className="glow" aria-hidden="true" />
        <div className="z">
          <h2>Every video you pay for teaches a robot.</h2>
          <p>
            Automated acceptance for companies that pay people to film their work. Upload videos your reviewers have already judged
            and see the report.
          </p>
          <div className="cta">
            <a className="b w" href="#start">
              Request a demo
            </a>
            <a className="b o" href="#steps">
              How it works
            </a>
          </div>
        </div>
        <footer className="ft">
          <span>QUELLIX</span>
          <nav aria-label="Footer">
            <a href="#steps">How it works</a>
            <Link href="/data">Privacy</Link>
            <a href="#faq">FAQ</a>
            <Link href="/login">Sign in</Link>
          </nav>
        </footer>
      </section>
    </div>
  );
}

const FAQ: [string, string][] = [
  ["Do I have to rebuild my app?", "No. Call the API where you approve videos today. Tasks, payouts and customers stay where they are."],
  ["Who sets the criteria?", "You, usually from your buyer’s spec. Each task has its own rubric, and every decision records the rubric version it used."],
  [
    "How accurate is it?",
    "We report precision and recall on rejections, compared with your own acceptance rate, on videos your reviewers or your lab have already judged. Doubtful cases go to review instead of being rejected.",
  ],
  ["Can I measure it against my lab’s decisions?", "Yes. Upload the lab’s accept or reject outcomes with your videos, and the report compares our decisions with theirs."],
  [
    "Does Quellix keep my videos?",
    "No. Videos are deleted after the analysis and never used to train models. We list every provider that processes them, and a DPA is available for every customer.",
  ],
  [
    "What do I get back for each video?",
    "The decision, the reasons and each measurement: when the task starts and ends, how long hands are visible, blur, privacy flags, originality, and the rubric version.",
  ],
];

function WindowBar({ title }: { title: string }) {
  return (
    <div className="x-wh">
      <i />
      <i />
      <i />
      <span>{title}</span>
    </div>
  );
}

function Field({ label, value, tone }: { label: string; value: string; tone?: "b" | "ok" | "no" }) {
  return (
    <div className="x-fld">
      <span>{label}</span>
      <span className={tone ? `x-t ${tone}` : "x-t"}>{value}</span>
    </div>
  );
}

function Row({ label, value, className }: { label: string; value: string; className?: string }) {
  return (
    <div className={className}>
      <span>{label}</span>
      <span>{value}</span>
    </div>
  );
}
