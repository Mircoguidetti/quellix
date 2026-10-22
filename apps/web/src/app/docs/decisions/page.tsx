import type { Metadata } from "next";
import { CircleCheck, CircleX, ScanEye, type LucideIcon } from "lucide-react";
import { Code } from "@/components/docs/code-block";
import { DocPage } from "@/components/docs/doc-page";
import { A, C, Callout, DataTable, FieldTable, H2, P, Ul } from "@/components/docs/prose";
import { cn } from "@/lib/utils";

export const metadata: Metadata = {
  title: "Decisions",
  description: "How Ormes turns measurements into accept, reject or review: the decision rule, reasons and their codes, measurements, check statuses and video statuses.",
};

const TOC = [
  { id: "rule", label: "The rule" },
  { id: "object", label: "The decision object" },
  { id: "reasons", label: "Reasons" },
  { id: "measurements", label: "Measurements" },
  { id: "check-statuses", label: "Check statuses" },
  { id: "video-statuses", label: "Video statuses" },
];

const RULE: { decision: string; icon: LucideIcon; tone: string; when: string; detail: string }[] = [
  {
    decision: "reject",
    icon: CircleX,
    tone: "bg-reject-bg text-reject-fg",
    when: "A critical check failed.",
    detail: "Also: a privacy or originality rule set to reject fired, or the file could not be decoded.",
  },
  {
    decision: "review",
    icon: ScanEye,
    tone: "bg-review-bg text-review-fg",
    when: "Nothing rejects, but something is doubtful.",
    detail: "A non-critical check failed, a check was uncertain or could not run, or a rule set to review fired.",
  },
  {
    decision: "accept",
    icon: CircleCheck,
    tone: "bg-accept-bg text-accept-fg",
    when: "No reasons at all.",
    detail: "Every enabled check passed.",
  },
];

const DECISION_JSON = `
{
  "video_id": "5b0c7f2e-…",
  "decision": "reject",
  "reasons": [
    {
      "check": "technical",
      "code": "technical.too_short",
      "message": "Video is 14s long (minimum 20s).",
      "effect": "reject"
    },
    {
      "check": "privacy",
      "code": "privacy.faces",
      "message": "A face is visible at 0:42 (+2 more).",
      "effect": "review"
    }
  ],
  "checks": {
    "technical": {
      "status": "fail",
      "measurements": { "duration_s": 14.2, "width": 1920, "height": 1080, "fps": 30, "blur_ratio": 0.01, "bad_exposure_ratio": 0.0 }
    },
    "privacy": { "status": "fail", "measurements": { "faces": [{ "t_s": 42.0 }, { "t_s": 43.5 }, { "t_s": 51.0 }] } },
    "task_completed": { "status": "skipped", "measurements": { "reason": "…" } }
  },
  "rubric": { "id": "rub_…", "version": 3 },
  "engine_version": "…",
  "created_at": "2026-10-22T09:16:40Z"
}
`;

const REASON_CODES: [string, string][] = [
  ["task_completed.not_completed", "The task does not appear to be completed."],
  ["task_completed.uncertain", "Not enough confidence either way. Always review."],
  ["hands_visible.below_min", "Hands visible less often than min_ratio."],
  ["hands_visible.missing_measurement", "Hand visibility could not be measured. Always review."],
  ["framing.off_target", "Camera pointed away from the work too often."],
  ["framing.unstable", "Camera unstable too often."],
  ["technical.not_decodable", "The file could not be decoded. Always reject."],
  ["technical.too_short / too_long", "Duration outside min_duration_s / max_duration_s."],
  ["technical.low_resolution", "Below min_width × min_height."],
  ["technical.low_fps", "Below min_fps."],
  ["technical.blurry", "Too many blurry frames."],
  ["technical.bad_exposure", "Too many frames too dark or too bright."],
  ["privacy.faces / documents / screens", "A face, readable document or readable screen is visible; the effect is the rule's setting."],
  ["originality.duplicate", "Already delivered to you; the effect is on_duplicate."],
  ["<check>.error", "A check could not run. Always review."],
  ["pipeline.skipped_without_reject", "Some checks were skipped without a rejection. Always review."],
];

const MEASUREMENTS: [string, string][] = [
  ["task_completed", "completed, confidence"],
  ["hands_visible", "ratio_both_manipulation, ratio_any_manipulation, ratio_both_whole, ratio_any_whole"],
  ["framing", "off_target_ratio, unstable_ratio"],
  ["technical", "decodable, duration_s, width, height, fps, blur_ratio, bad_exposure_ratio"],
  ["privacy", "faces, documents, screens: detections with their time t_s"],
  ["originality", "max_similarity, match_video_id"],
];

export default function DecisionsPage() {
  return (
    <DocPage
      href="/docs/decisions"
      toc={TOC}
      lead="Every video gets one of three decisions, and every decision carries its reasons, every measurement behind it, and the rubric id and version that produced it."
    >
      <H2 id="rule">The rule</H2>
      <P>Checks only measure. The rubric turns measurements into results, and one fixed rule turns results into the decision, in this order:</P>
      <ol className="mt-6 grid gap-2.5">
        {RULE.map((r, i) => (
          <li key={r.decision} className="flex gap-4 rounded-xl border border-border px-4 py-3.5">
            <span className="mt-0.5 font-mono text-[12px] text-muted-foreground">{i + 1}</span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                <span className={cn("inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 font-mono text-[12.5px] font-medium", r.tone)}>
                  <r.icon className="size-3.5" strokeWidth={1.5} aria-hidden />
                  {r.decision}
                </span>
                <span className="text-[15px] font-medium">{r.when}</span>
              </div>
              <p className="mt-1.5 text-[14px] leading-[1.6] text-muted-foreground">{r.detail}</p>
            </div>
          </li>
        ))}
      </ol>
      <Callout kind="note" title="Doubt goes to a person">
        A false reject costs an honest contributor money, so an uncertain result never rejects, even on a critical check. It sends the video to review.
      </Callout>

      <H2 id="object">The decision object</H2>
      <P>
        The decision is the <C>decision</C> field of a <C>Video</C> (it is <C>null</C> until the video is decided). The same object arrives in the{" "}
        <A href="/docs/webhooks">webhook</A>.
      </P>
      <FieldTable
        showDefault={false}
        caption="Decision fields"
        fields={[
          { name: "video_id", type: "string", required: true, description: "The video this decision is about." },
          { name: "decision", type: '"accept" | "reject" | "review"', required: true, description: "The outcome of the rule above." },
          { name: "reasons", type: "Reason[]", required: true, description: "Why. Empty for accept. Reasons that reject come first." },
          { name: "checks", type: "object", required: true, description: "One result per check: status, measurements and the model that produced them." },
          { name: "rubric", type: "{ id, version }", required: true, description: "The exact rubric version applied." },
          { name: "engine_version", type: "string", required: true, description: "Version of the decision engine." },
          { name: "created_at", type: "date-time", description: "When the decision was made." },
        ]}
      />
      <Code lang="json" title="decision">
        {DECISION_JSON}
      </Code>

      <H2 id="reasons">Reasons</H2>
      <P>
        A reason names the <C>check</C>, a stable machine <C>code</C>, a human-readable <C>message</C> and its <C>effect</C>: <C>reject</C> or <C>review</C>. Branch on{" "}
        <C>code</C>; show <C>message</C>. Messages include the measured value and the threshold, so a reviewer or a contributor can see how far off the video was.
      </P>
      <DataTable caption="Reason codes" head={["Code", "Meaning"]} rows={REASON_CODES.map(([code, meaning]) => [code, meaning])} />
      <P>
        Unless noted, the effect follows the check&apos;s <C>critical</C> setting. When a contributor <A href="/docs/review#contests">contests a rejection</A>, they see
        only the messages of reasons whose effect is <C>reject</C>; never measurements.
      </P>

      <H2 id="measurements">Measurements</H2>
      <P>
        Each check result keeps the raw values it produced, so you can audit a decision or re-apply a changed threshold without running the video again. Ratios are
        between 0 and 1; durations are in seconds. <C>model</C> says which model or method produced them.
      </P>
      <DataTable caption="Measurements by check" head={["Check", "Measurements"]} rows={MEASUREMENTS.map(([check, m]) => [check, <span key={check} className="font-mono text-[12.5px] text-foreground/80">{m}</span>])} />
      <P>We keep decisions, reasons and measurements after the video file itself is deleted.</P>

      <H2 id="check-statuses">Check statuses</H2>
      <DataTable
        caption="Check statuses"
        head={["Status", "Meaning"]}
        rows={[
          ["pass", "Within the rubric's thresholds."],
          ["fail", "Outside a threshold, or a rule fired. Rejects or reviews, see the reason's effect."],
          ["uncertain", "The check could not tell with enough confidence. Sends to review."],
          ["skipped", "Disabled in the rubric, or not run because the video was already rejected."],
          ["error", "The check could not run. Sends to review."],
        ]}
      />

      <H2 id="video-statuses">Video statuses</H2>
      <P>
        A video moves through these statuses. <C>decided</C>, <C>failed</C> and <C>deleted</C> are final.
      </P>
      <DataTable
        caption="Video statuses"
        head={["Status", "Meaning"]}
        rows={[
          ["awaiting_upload", "Registered; waiting for the file and the call to /complete."],
          ["queued", "File received; waiting for analysis."],
          ["processing", "Being analyzed."],
          ["decided", "The decision is ready."],
          ["failed", "Analysis failed after its last attempt. The file is deleted."],
          ["deleted", "The video was deleted."],
        ]}
      />
      <Ul>
        <li>The file is deleted as soon as a video is accepted or rejected.</li>
        <li>
          A video in review keeps its file until a person decides, at most 14 days, so the reviewer can watch it. See <A href="/docs/review">Review and contests</A>.
        </li>
      </Ul>
    </DocPage>
  );
}
