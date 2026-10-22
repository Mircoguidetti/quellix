// Generated from docs/design/site/product.html (issue #35). Keep the copy and structure in step with the design.
import Link from "next/link";
import { ReviewMock, ReviewMockCanvas } from "./review-mock";
import { SiteFooter } from "./site-footer";

export function ProductPage() {
  return (
    <main>{" "}
      <section className="ph1">
        <div className="hc">{" "}
          <div className="eyebrow">Product</div>{" "}
          <h1>One spec, applied the same way to every video.</h1>{" "}
          <p className="hl">How Ormes decides, what it measures, and the tools around the decision: rubrics, the review console, contests and your lab’s outcomes.</p>{" "}
          <nav className="toc" aria-label="On this page">
            <a href="#rule">The decision</a>
            <a href="#checks">Checks</a>
            <a href="#rubrics">Rubrics</a>
            <a href="#console">Review</a>
            <a href="#contests">Contests</a>
            <a href="#lab">Lab outcomes</a></nav>{" "}</div></section>{" "}
      <section className="sec" id="rule">
        <div className="wrap">{" "}
          <h2>Three answers, one rule.</h2>{" "}
          <p className="lead">Every check produces measurements. The rubric turns them into reasons. The reasons decide.</p>{" "}
          <div className="rule">{" "}
            <div>
              <h3>
                <span className="x-t no">reject</span></h3>
              <p>At least one reason has a reject effect: a critical check failed with a clear measurement, such as hands visible 61% against a minimum of 80%.</p></div>{" "}
            <div>
              <h3>
                <span className="x-t b">review</span></h3>
              <p>Something needs a person: a non-critical check failed, a face was found, or a model was not confident enough. Never a silent reject.</p></div>{" "}
            <div>
              <h3>
                <span className="x-t ok">accept</span></h3>
              <p>No reasons at all. Every enabled check passed. The decision still carries every measurement and the rubric version.</p></div>{" "}</div>{" "}</div></section>{" "}
      <section className="sec" id="checks">
        <div className="wrap">{" "}
          <h2>Every check, what it measures, what you set.</h2>{" "}
          <div className="tw">
            <table>{" "}
              <thead>
                <tr>
                  <th>Check</th>
                  <th>Measures</th>
                  <th>You set</th></tr></thead>{" "}
              <tbody>{" "}
                <tr>
                  <td>Hands on the work</td>
                  <td>Share of manipulation time with each hand fully in frame; contact with objects; intervals where a hand is cut</td>
                  <td>Minimum share, both hands or one, whole video or only while handling objects</td></tr>{" "}
                <tr>
                  <td>Task completed</td>
                  <td>Each step’s start and end, final state reached, model confidence</td>
                  <td>Steps, final state, minimum confidence before review</td></tr>{" "}
                <tr>
                  <td>Privacy</td>
                  <td>Faces, readable documents and screens: time and size of each detection</td>
                  <td>Reject, review or ignore, per kind</td></tr>{" "}
                <tr>
                  <td>Already delivered</td>
                  <td>Similarity to earlier videos of your organisation, including edited copies</td>
                  <td>Similarity threshold, reject or review</td></tr>{" "}
                <tr>
                  <td>Framing</td>
                  <td>Time pointed away from the work, unstable time</td>
                  <td>Maximum share of each</td></tr>{" "}
                <tr>
                  <td>Technical</td>
                  <td>Duration, resolution, frame rate, blurry and badly exposed frames</td>
                  <td>Minimums and maximums</td></tr>{" "}</tbody></table></div>{" "}
          <p className="note">Each check can be critical (a failure rejects) or not (a failure goes to review), or turned off.</p>{" "}</div></section>{" "}
      <section className="sec" id="rubrics">
        <div className="wrap">{" "}
          <h2>Rubrics are versioned, and previewed before you save.</h2>{" "}
          <p className="lead">Change a threshold and see how the last decisions would change before anything goes live. Old decisions keep the version they used.</p>{" "}
          <div className="dual">{" "}
            <div className="pn">
              <div className="x-win">
                <div className="x-wh">
                  <i></i>
                  <i></i>
                  <i></i>
                  <span>rubric · load the dishwasher · v3</span></div>{" "}
                <div className="x-fld">
                  <span>Hands, while handling objects</span>
                  <span className="x-t b">min 80%</span></div>{" "}
                <div className="x-fld">
                  <span>Task completed</span>
                  <span className="x-t b">critical · 70%</span></div>{" "}
                <div className="x-fld">
                  <span>Faces, documents, screens</span>
                  <span className="x-t">review</span></div>{" "}
                <div className="x-fld">
                  <span>Already delivered</span>
                  <span className="x-t">reject ≥ 0.90</span></div>{" "}
                <div className="x-note">Saving creates version 4. 1 of the last 178 decisions would change.</div></div></div>{" "}
            <div className="frd">{" "}
              <div>
                <h3>{"From the lab\u2019s spec "}
                  <span className="badge">soon</span></h3>
                <p>Paste the lab’s guidelines and Ormes drafts the rubric, each value tied to the line it came from. You review and save.</p></div>{" "}
              <div>
                <h3>{"A library of specs "}
                  <span className="badge">soon</span></h3>
                <p>Ready rubrics for common task families: kitchen, laundry, factory assembly.</p></div>{" "}
              <div>
                <h3>Per task, per lab</h3>
                <p>Each task has its own rubric. Different labs, different rubrics, one API.</p></div>{" "}</div></div>{" "}</div></section>{" "}
      <section className="sec" id="console">
        <div className="wrap">{" "}
          <h2>The review console.</h2>{" "}
          <p className="lead">Only doubtful videos arrive here, each with its reasons pinned to the timeline.</p>{" "}
          <ReviewMock className="app" role="img" aria-label="The Ormes review screen: a queue of doubtful videos on the left, the selected video with its flagged moments and Accept and Reject buttons on the right">{" "}
            <aside>
              <div className="logo">
                <i aria-hidden="true"></i>ORMES</div>{" "}
              <a>
                <svg viewBox="0 0 24 24">
                  <rect x="3" y="3" width="7" height="9" rx="1"></rect>
                  <rect x="14" y="3" width="7" height="5" rx="1"></rect>
                  <rect x="14" y="12" width="7" height="9" rx="1"></rect>
                  <rect x="3" y="16" width="7" height="5" rx="1"></rect></svg>Overview</a>
              <a className="on">
                <svg viewBox="0 0 24 24">
                  <path d="M22 12h-6l-2 3h-4l-2-3H2"></path>
                  <path d="M5.5 5h13L22 12v6a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-6z"></path></svg>Review
                <em>11</em></a>
              <a>
                <svg viewBox="0 0 24 24">
                  <rect x="3" y="3" width="18" height="18" rx="2"></rect>
                  <path d="M7 3v18M17 3v18M3 8h4M3 16h4M17 8h4M17 16h4"></path></svg>Videos</a>
              <a>
                <svg viewBox="0 0 24 24">
                  <path d="M9 6h11M9 12h11M9 18h11M4 6l1 1 2-2M4 12l1 1 2-2M4 18l1 1 2-2"></path></svg>Rubrics</a>
              <a>
                <svg viewBox="0 0 24 24">
                  <path d="M12 3v18M7 21h10M5 7h14M5 7l-3 7a4 4 0 0 0 6 0zM19 7l-3 7a4 4 0 0 0 6 0z"></path></svg>Contests</a>
              <a>
                <svg viewBox="0 0 24 24">
                  <circle cx="12" cy="12" r="3"></circle>
                  <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"></path></svg>Settings</a>{" "}
              <div className="org">
                <b>Northwind Capture</b>example data</div></aside>{" "}
            <main>
              <div className="top">
                <h4>Review</h4>
                <small>{"11 waiting \u00b7 "}
                  <span className="kbd">J</span>{" "}
                  <span className="kbd">K</span>{" to move"}</small></div>{" "}
              <div className="split2">
                <div className="q">{" "}
                  <div>
                    <b>{"v_89148 "}
                      <em className="pillv">review</em></b>
                    <span>Task may end before the door closes</span></div>{" "}
                  <div className="on">
                    <b>{"v_89163 "}
                      <em className="pillv">review</em></b>
                    <span>Readable document at 00:27</span></div>{" "}
                  <div>
                    <b>{"v_89179 "}
                      <em className="pillv">review</em></b>
                    <span>Camera off the work 32% of the time</span></div>{" "}
                  <div>
                    <b>{"v_89189 "}
                      <em className="pillv">review</em></b>
                    <span>Right hand cut by the edge, 00:41–00:52</span></div>{" "}
                  <div>
                    <b>{"v_89199 "}
                      <em className="pillv">review</em></b>
                    <span>Not sure the last step happened</span></div>{" "}</div>{" "}
                <div className="det">
                  <div className="vid">
                    <ReviewMockCanvas /></div>{" "}
                  <div className="tl" aria-hidden="true">
                    <i style={{ left: "12%", width: "6%", background: "#f3c9c2" }}></i>
                    <i style={{ left: "33%", width: "3%", background: "#c9d8f7" }}></i>
                    <i style={{ left: "62%", width: "9%", background: "#f3c9c2" }}></i>
                    <span className="pl"></span></div>{" "}
                  <div className="rs">
                    <div>
                      <span className="pillv">review</span>Readable document visible
                      <span className="ts">00:27</span></div>
                    <div>
                      <span className="pilla">pass</span>Both hands visible while handling objects, 91%
                      <span className="ts">min 80%</span></div>
                    <div>
                      <span className="pilla">pass</span>All 3 steps found
                      <span className="ts">00:03 → 02:41</span></div></div>{" "}
                  <div className="acts">
                    <span className="a1">{"Accept "}
                      <span className="kbd">A</span></span>
                    <span>{"Reject "}
                      <span className="kbd">R</span></span>
                    <span>{"Next moment "}
                      <span className="kbd">↵</span></span></div>{" "}</div></div></main>
          </ReviewMock>{" "}
          <div className="tw">
            <table>
              <thead>
                <tr>
                  <th>Key</th>
                  <th>Action</th></tr></thead>
              <tbody>{" "}
                <tr>
                  <td>
                    <code>A</code>{" / "}
                    <code>R</code></td>
                  <td>Accept or reject the current video</td></tr>{" "}
                <tr>
                  <td>
                    <code>J</code>{" / "}
                    <code>K</code></td>
                  <td>Next or previous video in the queue</td></tr>{" "}
                <tr>
                  <td>
                    <code>Enter</code></td>
                  <td>Jump the player to the next flagged moment</td></tr>{" "}
                <tr>
                  <td>
                    <code>N</code></td>
                  <td>Write a note, kept with the decision</td></tr>{" "}</tbody></table></div>{" "}</div></section>{" "}
      <section className="sec" id="contests">
        <div className="wrap">{" "}
          <h2>A person can always contest.</h2>{" "}
          <p className="lead">A contributor who disagrees with a rejection opens a contest from a link. They see only the reasons that caused the rejection; a person on your team decides.</p>{" "}
          <div className="caps">
            <div>
              <h3>Only what matters</h3>
              <p>Contributors see the reasons that rejected the video, never internal signals such as duplicate matching.</p></div>
            <div>
              <h3>Decided by a person</h3>
              <p>Upheld or overturned, with a note. The outcome is stored with the video.</p></div>
            <div>
              <h3>Measured</h3>
              <p>Overturned rejections count as our mistakes in your precision report.</p></div></div>{" "}</div></section>{" "}
      <section className="sec" id="lab">
        <div className="wrap">{" "}
          <h2>Measured against your lab, not against itself.</h2>{" "}
          <p className="lead">Send the lab’s accept or reject for delivered videos. Ormes reports precision and recall on rejections against your reject rate, per rubric version, and proposes threshold changes as a new version you approve.</p>{" "}
          <div className="dual">{" "}
            <div className="pn">
              <div className="x-win">
                <div className="x-wh">
                  <i></i>
                  <i></i>
                  <i></i>
                  <span>report · load the dishwasher · v3 · example</span></div>{" "}
                <div className="x-fld">
                  <span>Lab reject rate</span>
                  <span className="x-t">9%</span></div>{" "}
                <div className="x-fld">
                  <span>Reject precision</span>
                  <span className="x-t ok">0.94</span></div>{" "}
                <div className="x-fld">
                  <span>Reject recall</span>
                  <span className="x-t">0.81</span></div>{" "}
                <div className="x-fld">
                  <span>Sent to review</span>
                  <span className="x-t">12%</span></div>{" "}
                <div className="x-note">Example figures. Your pilot report uses your videos and your lab’s decisions.</div></div></div>{" "}
            <div className="frd">{" "}
              <div>
                <h3>{"An audit trail for the lab "}
                  <span className="badge">soon</span></h3>
                <p>Per batch and rubric version: pass rate per check, rejection codes, reviewer overrides, sampling rate. CSV and JSON.</p></div>{" "}
              <div>
                <h3>{"Contributor reliability "}
                  <span className="badge">soon</span></h3>
                <p>First-pass rate and rejection history per anonymous contributor id, so you know whom to coach.</p></div>{" "}
              <div>
                <h3>{"Step timestamps "}
                  <span className="badge">later</span></h3>
                <p>Where each step starts and ends, returned with the decision.</p></div>{" "}</div></div>{" "}</div></section>{" "}
      <section className="end" id="start">
        <div className="glow" aria-hidden="true"></div>{" "}
        <div className="z">
          <h2>See it on your own videos.</h2>
          <p>Send a batch your reviewers have already judged. We return the decisions and a report of the hours saved.</p>{" "}
          <div className="cta">
            <Link className="b w" href="/signup">Start a free pilot</Link>
            <Link className="b o" href="/developers">Read the API</Link></div></div>{" "}
        <SiteFooter />{" "}
        <p className="note" style={{ padding: "0 16px 28px" }}>Demo footage on this site: Build AI Egocentric-10K, Apache 2.0.</p>{" "}</section>{" "}
    </main>
  );
}
