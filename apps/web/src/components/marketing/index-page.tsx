// Generated from docs/design/site/index.html (issue #35). Keep the copy and structure in step with the design.
import { Fragment } from "react";
import Link from "next/link";
import { CodeTabs } from "./code-tabs";
import { HeroCanvas } from "./hero-canvas";
import { ReviewMock, ReviewMockCanvas } from "./review-mock";
import { SiteFooter } from "./site-footer";

export function HomePage() {
  return (
    <main>{" "}
      <section className="hero" id="top">
        <div className="hc">{" "}
          <h1>Stop watching every video before you pay for it.</h1>{" "}
          <p className="hl">Ormes applies your lab’s spec to every first-person video and decides accept, reject or review. It checks what your reviewers check by hand: hands on the work, every step done, nothing private in view.</p>{" "}
          <div className="hb">
            <Link className="b w" href="/signup">Start a free pilot</Link>
            <Link className="b o" href="/product">See the product</Link></div>{" "}
          <div className="trust">
            <span>API and SDKs</span>
            <span>Review console</span>
            <span>Videos deleted after analysis</span></div>{" "}
          <div className="vis">
            <div className="scr">
              <HeroCanvas />{" "}
              <div className="hud" aria-hidden="true">
                <span className="rc">
                  <i></i>REC 00:24</span>
                <span>load the dishwasher</span></div></div>{" "}
            <div className="ov">
              <div className="ovh">
                <span>v_88213</span>
                <span className="x-t ok">accept</span></div>{" "}
              <div className="x-fld">
                <span>Steps done</span>
                <span className="x-t">3 of 3</span></div>{" "}
              <div className="x-fld">
                <span>Hands on the work</span>
                <span className="x-t b">92%</span></div>{" "}
              <div className="x-fld">
                <span>Personal data</span>
                <span className="x-t">none</span></div></div>{" "}</div>{" "}</div></section>{" "}
      <section className="sec" id="problem">
        <div className="wrap">{" "}
          <h2>Your upload checks catch blur. People still judge everything else.</h2>{" "}
          <p className="lead">Most clips are rejected for what was recorded, not how: a hand out of frame, a task stopped early, a face in view. Those calls are still made by a person watching the video.</p>{" "}
          <div className="cost">{" "}
            <div className="pk">
              <span className="ph">Without Ormes</span>
              <div className="pp2">500 h</div>
              <div className="pe">of review per month, example</div>{" "}
              <div className="calc">
                <div>
                  <span>Videos received</span>
                  <span>10,000</span></div>
                <div>
                  <span>Watched by a person</span>
                  <span>10,000</span></div>
                <div>
                  <span>Review time per video</span>
                  <span>3 min</span></div>
                <div className="neg">
                  <span>Review hours</span>
                  <span>500</span></div></div>{" "}
              <ul className="ls n">
                <li>Each reviewer reads the spec their own way</li>
                <li>Contributors wait days to learn why a video failed</li></ul></div>{" "}
            <div className="pk on">
              <span className="ph">With Ormes</span>
              <div className="pp2">75 h</div>
              <div className="pe">of review per month, example</div>{" "}
              <div className="calc">
                <div>
                  <span>Decided automatically</span>
                  <span>8,500</span></div>
                <div>
                  <span>Sent to review</span>
                  <span>1,500</span></div>
                <div>
                  <span>Review time per case</span>
                  <span>3 min</span></div>
                <div className="tot">
                  <span>Review hours</span>
                  <span>75</span></div></div>{" "}
              <ul className="ls y">
                <li>The same spec on every video, with reasons</li>
                <li>Contributors see what to fix and re-record</li></ul></div>{" "}</div>
          <p className="note">Hypothetical numbers: 10,000 videos a month, 3 minutes each, 15% sent to review. Your pilot report shows your own.</p>{" "}</div></section>{" "}
      <section className="sec" id="checks">
        <div className="wrap">{" "}
          <div className="eyebrow">What gets checked</div>{" "}
          <h2>The checks your reviewers do, on every video.</h2>{" "}
          <p className="lead">Each check returns a measurement and the moments it found. Your rubric decides what rejects, what goes to review and what is ignored.</p>{" "}
          <div className="chk">{" "}
            <div>
              <h3>{"Hands on the work "}
                <span className="x-t b">core</span></h3>
              <p>Both hands visible while they handle objects, measured only during the work. Hands cut by the edge are found to the second.</p>
              <div className="m">
                <span className="x-t">91% while handling</span>
                <span className="x-t no">00:41–00:52 cut</span></div></div>{" "}
            <div>
              <h3>{"Task completed "}
                <span className="x-t b">core</span></h3>
              <p>Every step of the task found in order, with the final state checked. When the model is not sure, the video goes to review, never to accept.</p>
              <div className="m">
                <span className="x-t">3 of 3 steps</span>
                <span className="x-t">00:03 → 02:41</span></div></div>{" "}
            <div>
              <h3>Privacy</h3>
              <p>Faces, readable documents and screens, with the time and size of each detection. You choose reject, review or ignore.</p>
              <div className="m">
                <span className="x-t">document 00:27</span></div></div>{" "}
            <div>
              <h3>Already delivered</h3>
              <p>Re-uploads and edited copies from your own contributors: re-encoded, cropped, mirrored, sped up or trimmed.</p>
              <div className="m">
                <span className="x-t">similarity 0.98</span>
                <span className="x-t">v_80102</span></div></div>{" "}
            <div>
              <h3>Framing</h3>
              <p>Camera pointed at the work and steady. Time off target and unstable time, against your limits.</p>
              <div className="m">
                <span className="x-t">off target 4%</span></div></div>{" "}
            <div>
              <h3>Technical</h3>
              <p>Duration, resolution, frame rate, blur and exposure. Included so one call covers the whole spec.</p>
              <div className="m">
                <span className="x-t">1920×1080 · 30 fps</span></div></div>{" "}</div>{" "}
          <p className="more">
            <Link href="/product#checks">Every check and setting →</Link></p>{" "}</div></section>{" "}
      <section className="sec" id="console">
        <div className="wrap">{" "}
          <div className="eyebrow">Review console</div>{" "}
          <h2>Doubtful cases take seconds, not minutes.</h2>{" "}
          <p className="lead">Reviewers never watch a whole video. They jump to the flagged moments, decide with one key and move on.</p>{" "}
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
          <div className="caps">
            <div>
              <h3>Jump to the moment</h3>
              <p>Every reason is pinned to the timeline. Enter goes to the next one.</p></div>
            <div>
              <h3>One key per decision</h3>
              <p>A to accept, R to reject, J and K to move through the queue.</p></div>
            <div>
              <h3>Overrides are kept</h3>
              <p>Each human decision and note is stored with the video’s report, for your lab and for calibration.</p></div></div>{" "}</div></section>{" "}
      <section className="sec" id="coach">
        <div className="wrap">{" "}
          <div className="eyebrow">Contributor feedback</div>{" "}
          <h2>Fewer rejections, not only faster ones.</h2>{" "}
          <p className="lead">A reject is an hour you can’t bill and money an honest contributor doesn’t get. Ormes tells the person what went wrong, when, and how to fix it, while they can still record again.</p>{" "}
          <div className="dual">{" "}
            <div className="pn">
              <div className="x-win">
                <div className="x-wh">
                  <i></i>
                  <i></i>
                  <i></i>
                  <span>shown to contributor c_4086</span></div>{" "}
                <div className="x-fld">
                  <span>Right hand left the frame</span>
                  <span className="x-t no">00:41–00:52</span></div>{" "}
                <div className="x-fld">
                  <span>Dishwasher door not closed at the end</span>
                  <span className="x-t no">02:41</span></div>{" "}
                <div className="x-note">Hold the phone a little lower and finish by closing the door. Then record again.</div></div></div>{" "}
            <div className="frd">{" "}
              <div>
                <h3>{"Right after upload "}
                  <span className="badge">soon</span></h3>
                <p>The reason, the time and one concrete fix, returned by the API and ready to show in your app.</p></div>{" "}
              <div>
                <h3>{"While recording "}
                  <span className="badge">soon</span></h3>
                <p>The mobile SDK warns on the phone when a hand leaves the frame or the light drops, so the bad take never happens.</p></div>{" "}
              <div>
                <h3>{"Before the task "}
                  <span className="badge">soon</span></h3>
                <p>A five-second test shot checks camera position and light before twenty minutes are recorded.</p></div>{" "}</div></div>{" "}</div></section>{" "}
      <section className="sec" id="api">
        <div className="wrap">{" "}
          <div className="eyebrow">Integration</div>{" "}
          <h2>One call where you approve videos today.</h2>{" "}
          <p className="lead">Recruiting, tasks and payouts stay in your app. Ormes returns the decision by webhook or by polling.</p>{" "}
          <div className="int">{" "}
            <div className="steps">{" "}
              <div>
                <b>1</b>
                <h3>Write the rubric once</h3>
                <p>From your lab’s spec, one per task. Every decision records the version it used.</p></div>{" "}
              <div>
                <b>2</b>
                <h3>Send each upload</h3>
                <p>
                  <code>videos.upload()</code>{" in TypeScript or Python, or three REST calls."}</p></div>{" "}
              <div>
                <b>3</b>
                <h3>Act on the decision</h3>
                <p>Pay, reject with the reason, or route to your reviewers. Signed webhooks, typed errors, retries built in.</p></div>{" "}</div>{" "}
            <CodeTabs
              className="code"
              labels={["TypeScript", "Python", "cURL"]}
              panels={[
                <Fragment key={0}><span className="k">{"import"}</span>{" { Ormes } "}<span className="k">{"from"}</span>{" "}<span className="s">{"\"@ormes/sdk\""}</span>{";\n\n"}<span className="k">{"const"}</span>{" qx = "}<span className="k">{"new"}</span>{" Ormes(); "}<span className="c">{"// reads ORMES_API_KEY"}</span>{"\n\n"}<span className="k">{"const"}</span>{" video = "}<span className="k">{"await"}</span>{" qx.videos.upload("}<span className="s">{"\"./v_88214.mp4\""}</span>{", {\n  rubricId: "}<span className="s">{"\"rub_load_dishwasher\""}</span>{",\n  contributorRef: "}<span className="s">{"\"c_4086\""}</span>{",\n});\n"}<span className="k">{"const"}</span>{" d = "}<span className="k">{"await"}</span>{" qx.videos.waitForDecision(video.id);\n\nd.decision;      "}<span className="c">{"// \"reject\""}</span>{"\nd.reasons[0];    "}<span className="c">{"// hands_visible.below_min, 61% (min 80%)"}</span></Fragment>,
                <Fragment key={1}><span className="k">{"from"}</span>{" ormes "}<span className="k">{"import"}</span>{" Ormes\n\nqx = Ormes()  "}<span className="c">{"# reads ORMES_API_KEY"}</span>{"\n\nvideo = qx.videos.upload("}<span className="s">{"\"v_88214.mp4\""}</span>{",\n                         rubric_id="}<span className="s">{"\"rub_load_dishwasher\""}</span>{",\n                         contributor_ref="}<span className="s">{"\"c_4086\""}</span>{")\nd = qx.videos.wait_for_decision(video.id)\n\nd.decision      "}<span className="c">{"# \"reject\""}</span>{"\nd.reasons[0]    "}<span className="c">{"# hands_visible.below_min, 61% (min 80%)"}</span></Fragment>,
                <Fragment key={2}><span className="c">{"# 1. register the video, get a signed upload URL"}</span>{"\ncurl -X POST $QX/v1/videos -H "}<span className="s">{"\"Authorization: Bearer $ORMES_API_KEY\""}</span>{" \\\n  -d "}<span className="s">{"'{\"rubric_id\":\"rub_load_dishwasher\",\"filename\":\"v_88214.mp4\",\n       \"content_type\":\"video/mp4\",\"size_bytes\":48211234}'"}</span>{"\n"}<span className="c">{"# 2. PUT the file to upload_url"}</span>{"\ncurl -X PUT "}<span className="s">{"\"$UPLOAD_URL\""}</span>{" -H "}<span className="s">{"\"Content-Type: video/mp4\""}</span>{" --data-binary @v_88214.mp4\n"}<span className="c">{"# 3. start the analysis; the decision arrives by webhook"}</span>{"\ncurl -X POST $QX/v1/videos/$ID/complete -H "}<span className="s">{"\"Authorization: Bearer $ORMES_API_KEY\""}</span></Fragment>,
              ]}
            />{" "}</div>{" "}
          <p className="more">
            <Link href="/developers">Developer docs →</Link></p>{" "}</div></section>{" "}
      <section className="sec" id="privacy">
        <div className="wrap">{" "}
          <h2>Videos are checked, not kept.</h2>{" "}
          <p className="lead">Ormes analyses each video, returns its decision and deletes it. Videos waiting for a reviewer stay at most 14 days. Nothing is used to train models unless you opt in.</p>{" "}
          <div className="body">
            <div className="flow">{" "}
              <div className="nd">
                <small>Phone</small>
                <h3>Contributor</h3>
                <span className="x-g" style={{ width: "82%" }}></span>
                <span className="x-g bl" style={{ width: "46%" }}></span>
                <span className="x-g" style={{ width: "64%" }}></span></div>{" "}
              <div className="ln" aria-hidden="true"></div>{" "}
              <div className="nd on">
                <small>Cloud</small>
                <h3>Ormes</h3>
                <div className="tags">
                  <span className="x-t b">decision</span>
                  <span className="x-t b">reasons</span>
                  <span className="x-t b">measurements</span>
                  <span className="x-t b">fingerprint</span></div></div>{" "}
              <div className="ln" aria-hidden="true"></div>{" "}
              <div className="nd">
                <small>Your platform</small>
                <h3>Pays and delivers</h3>
                <span className="x-g" style={{ width: "72%" }}></span>
                <span className="x-g" style={{ width: "50%" }}></span></div>{" "}</div></div>{" "}
          <p className="more">
            <Link href="/security">How your data is handled →</Link></p>{" "}</div></section>{" "}
      <section className="sec" id="limits">
        <div className="wrap">{" "}
          <h2>What Ormes doesn’t do.</h2>{" "}
          <div className="rows">{" "}
            <div className="rw">
              <h3>It doesn’t sell your data.</h3>
              <p>We check your videos and delete them. We don’t offer them to labs or to other customers.</p></div>{" "}
            <div className="rw">
              <h3>It doesn’t take the last word.</h3>
              <p>You set the rubric, reviewers can override any decision, and contributors can contest a rejection with a person.</p></div>{" "}
            <div className="rw">
              <h3>It doesn’t promise what your lab will accept.</h3>
              <p>It applies the spec you give it, the same way on every video. Send your lab’s decisions and we measure ourselves against them.</p></div>{" "}
            <div className="rw">
              <h3>It doesn’t reject when it isn’t sure.</h3>
              <p>A doubtful case goes to review. A wrong rejection costs a contributor money, so we treat it as the worst mistake.</p></div>{" "}</div></div></section>{" "}
      <section className="sec" id="pricing">
        <div className="wrap">{" "}
          <h2>Pay per hour of video checked.</h2>{" "}
          <p className="lead">Start with a free pilot on videos your reviewers have already judged. You get a report of the hours saved before you pay anything.</p>{" "}
          <ul className="ck">
            <li>
              <b>Free pilot</b>{" with a savings report"}</li>
            <li>
              <b>Usage-based</b>, per hour of video</li>
            <li>
              <b>Discount</b>{" if you allow training on your videos"}</li>
            <li>
              <b>DPA included</b>{" for every customer"}</li></ul>{" "}</div></section>{" "}
      <section className="sec" id="faq">
        <div className="wrap">{" "}
          <h2>Questions</h2>{" "}
          <div className="faq">{" "}
            <details>
              <summary>We already check uploads. Why Ormes?</summary>
              <p>Upload checks catch technical problems. The expensive calls are hands, steps and privacy, which today need a person. Ormes makes those calls with reasons and sends only the doubtful ones to your reviewers.</p></details>{" "}
            <details>
              <summary>Why not prompt a general video model?</summary>
              <p>General models are cheap, but in published tests of judging whether a task succeeded the best one is wrong about one time in four, and they lean toward “success”. Those are the videos your lab sends back. Ormes uses its own models for hands and tasks, and sends doubtful cases to review.</p></details>{" "}
            <details>
              <summary>Who sets the criteria?</summary>
              <p>You, from your lab’s spec. Each task has its own rubric, and every decision records the rubric version it used.</p></details>{" "}
            <details>
              <summary>How accurate is it?</summary>
              <p>We report precision and recall on rejections against your own reject rate, on videos your reviewers or your lab have already judged. That is the pilot report.</p></details>{" "}
            <details>
              <summary>Does Ormes keep my videos?</summary>
              <p>No. Videos are deleted after analysis; those waiting for review within 14 days. We keep decisions, reasons and measurements so you have a record of every call.</p></details>{" "}</div></div></section>{" "}
      <section className="end" id="start">
        <div className="glow" aria-hidden="true"></div>{" "}
        <div className="z">
          <h2>Every video you pay for teaches a robot.</h2>
          <p>Make sure it teaches the right thing. Send videos your reviewers have already judged and see the report.</p>{" "}
          <div className="cta">
            <Link className="b w" href="/signup">Start a free pilot</Link>
            <Link className="b o" href="/developers">Read the API</Link></div></div>{" "}
        <SiteFooter />{" "}
</section>{" "}
    </main>
  );
}
