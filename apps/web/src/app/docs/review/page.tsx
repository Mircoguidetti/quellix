import type { Metadata } from "next";
import { ArrowRight, Gavel, MessageSquareText, UserRound } from "lucide-react";
import { CodeBlock } from "@/components/docs/code-block";
import { DocPage } from "@/components/docs/doc-page";
import { A, C, Callout, Endpoint, H2, P, Ul } from "@/components/docs/prose";

export const metadata: Metadata = {
  title: "Review and contests",
  description: "Record a reviewer's decision, send Ormes the lab's outcome to measure precision on rejections, and handle contributors who contest a rejection.",
};

const TOC = [
  { id: "review", label: "Record a review" },
  { id: "lab-outcomes", label: "Lab outcomes" },
  { id: "contests", label: "Contests" },
  { id: "what-we-keep", label: "What we keep" },
];

const REVIEW_TS = `
const video = await ormes.review.submit(videoId, {
  decision: "accept",
  note: "Hands leave the frame only while reaching for the rack.",
});

console.log(video.review); // { decision: "accept", note: "…", reviewed_at: "…" }
`;
const REVIEW_PY = `
video = ormes.review.submit(
    video_id,
    decision="accept",
    note="Hands leave the frame only while reaching for the rack.",
)

print(video.review)  # decision, note, reviewed_at
`;
const REVIEW_CURL = `
curl -X POST "$ORMES_BASE_URL/videos/$VIDEO_ID/review" \\
  -H "Authorization: Bearer $ORMES_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"decision": "accept", "note": "Hands leave the frame only while reaching for the rack."}'
`;

const LAB_TS = `
await ormes.labOutcome.submit(videoId, { outcome: "reject", reason: "Lab QA: gloves not allowed." });

// Or, when you already know it, at upload time:
await ormes.videos.upload("./v_88214.mp4", { rubric_id, lab_outcome: { outcome: "accept" } });
`;
const LAB_PY = `
ormes.lab_outcome.submit(video_id, outcome="reject", reason="Lab QA: gloves not allowed.")

# Or, when you already know it, at upload time:
ormes.videos.upload("v_88214.mp4", rubric_id=rubric_id, lab_outcome={"outcome": "accept"})
`;
const LAB_CURL = `
curl -X POST "$ORMES_BASE_URL/videos/$VIDEO_ID/lab-outcome" \\
  -H "Authorization: Bearer $ORMES_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"outcome": "reject", "reason": "Lab QA: gloves not allowed."}'
`;

const CONTEST_FLOW = [
  { icon: UserRound, who: "Contributor", what: "Opens the contest link, reads why the video was rejected and writes why it should not have been. No account needed." },
  { icon: MessageSquareText, who: "Your team", what: "Sees the open contest in the dashboard under Contests, with the video's reasons and the message." },
  { icon: Gavel, who: "A person decides", what: "Upholds or overturns the rejection with a note. The resolution is final and recorded with their name." },
];

export default function ReviewPage() {
  return (
    <DocPage
      href="/docs/review"
      toc={TOC}
      lead="Ormes only sends the doubtful videos to people. This page covers what happens next: the reviewer's decision, what the lab finally decided, and contributors who contest a rejection."
    >
      <H2 id="review">Record a review</H2>
      <P>
        Videos whose decision is <C>review</C> appear in the dashboard&apos;s review list, with the reasons and a player. If your reviewers work in your own tools
        instead, send their decision through the API. It works on any video, though it is meant for the ones in review.
      </P>
      <Endpoint method="POST" path="/videos/{video_id}/review" sdk={{ ts: "ormes.review.submit(id, { decision, note })", py: "ormes.review.submit(id, decision=, note=)" }} />
      <Ul>
        <li>
          <C>decision</C> is <C>accept</C> or <C>reject</C>; <C>note</C> is optional, up to 2,000 characters. Write what you checked: the note is kept with the review.
        </li>
        <li>
          The response is the video, with the new review in <C>review</C>. Ormes&apos;s own <C>decision</C> stays as it was, so you can compare the two.
        </li>
      </Ul>
      <CodeBlock
        samples={[
          { lang: "ts", code: REVIEW_TS },
          { lang: "py", code: REVIEW_PY },
          { lang: "bash", code: REVIEW_CURL },
        ]}
      />
      <Callout kind="note" title="The file waits for the reviewer">
        A video in review keeps its file until a person decides, at most 14 days, then it is deleted anyway. Accepted and rejected videos are deleted right after
        analysis.
      </Callout>

      <H2 id="lab-outcomes">Lab outcomes</H2>
      <P>
        The lab has the last word on what it pays for. Tell Ormes what the lab decided and Ormes measures its precision and recall on rejections against your own base
        rate: how often a video Ormes rejected was really one the lab would have refused. This is how you know whether Ormes saves review hours without throwing away
        good videos.
      </P>
      <Endpoint method="POST" path="/videos/{video_id}/lab-outcome" sdk={{ ts: "ormes.labOutcome.submit(id, { outcome, reason })", py: "ormes.lab_outcome.submit(id, outcome=, reason=)" }} />
      <P>
        <C>outcome</C> is <C>accept</C> or <C>reject</C>; <C>reason</C> is optional, up to 2,000 characters. You can also pass <C>lab_outcome</C> when you upload.
      </P>
      <CodeBlock
        samples={[
          { lang: "ts", code: LAB_TS },
          { lang: "py", code: LAB_PY },
          { lang: "bash", code: LAB_CURL },
        ]}
      />

      <H2 id="contests">Contests</H2>
      <P>
        A contributor whose video was rejected can contest it. Contests are a dashboard flow: there is no API endpoint for them. Each rejected video has a public
        contest page at <C>/contest/{"{video_id}"}</C> on the Ormes site; send that link to the contributor with your rejection.
      </P>
      <ol className="mt-6 grid gap-2 sm:grid-cols-3">
        {CONTEST_FLOW.map((step, i) => (
          <li key={step.who} className="relative rounded-xl border border-border p-4">
            <span className="flex items-center justify-between">
              <span className="grid size-8 place-items-center rounded-lg bg-muted text-foreground/75">
                <step.icon className="size-4" strokeWidth={1.5} aria-hidden />
              </span>
              {i < CONTEST_FLOW.length - 1 ? <ArrowRight className="hidden size-3.5 text-muted-foreground sm:block" strokeWidth={1.5} aria-hidden /> : null}
            </span>
            <span className="mt-3 block text-[14.5px] font-medium">{step.who}</span>
            <span className="mt-1 block text-[13.5px] leading-[1.55] text-muted-foreground">{step.what}</span>
          </li>
        ))}
      </ol>
      <Ul>
        <li>
          The contributor sees only the messages of the reasons that rejected the video: never measurements, other reasons or your data.
        </li>
        <li>
          A video can be contested when its latest decision is a rejection, either by Ormes or by a reviewer who rejected it. A video that a reviewer accepted cannot be
          contested.
        </li>
        <li>One contest can be open per video at a time; the message is up to 4,000 characters.</li>
        <li>
          Contests are tied to the video&apos;s <C>contributor_ref</C>, your opaque id for the contributor. Never put a name or an email in it.
        </li>
      </Ul>

      <H2 id="what-we-keep">What we keep</H2>
      <P>
        Video files are deleted after analysis. For each video we keep the decision, the reasons, every measurement, the rubric version, reviewer decisions with their
        notes, lab outcomes, contest resolutions and the fingerprints used for originality. They belong to your organization and are never shared with another
        customer. Your videos are never used for training unless you opt in. See <A href="/data">Data handling</A>.
      </P>
    </DocPage>
  );
}
