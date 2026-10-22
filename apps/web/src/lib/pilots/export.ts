import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { csvCell } from "@/lib/domain/audit";
import { describeCriterion, METRICS, type PilotReport } from "./report";

export type PilotMeta = { id: string; name: string; rubric_name: string; rubric_version: number; created_at: string };

const pct = (x: number | null) => (x === null ? "-" : `${Math.round(x * 1000) / 10}%`);
const signed = (x: number | null) => (x === null ? "-" : `${x > 0 ? "+" : x < 0 ? "-" : ""}${Math.round(Math.abs(x) * 1000) / 10}%`);
const num1 = (x: number | null) => (x === null ? "-" : (Math.round(x * 10) / 10).toString());

export function outcomeOf(r: PilotReport["rows"][number]): string {
  if (!r.ormes_decision) return r.status;
  if (r.ormes_decision === "review") return "sent_to_review";
  if (r.ormes_decision === r.reviewer_decision) return "agree";
  return r.ormes_decision === "accept" ? "false_accept" : "false_reject";
}

/** One row per video, ready for a spreadsheet: their decision, ours, and why. */
export function pilotToCsv(report: PilotReport): string {
  const moments = new Map(report.disagreements.map((d) => [d.external_id, d.moments.map((m) => `${m.t ?? "whole video"} ${m.label}`).join("; ")]));
  const header = ["external_id", "reviewer_decision", "ormes_decision", "outcome", "lab_outcome", "reviewer_minutes", "duration_s", "reasons", "moments_to_inspect"];
  const lines = [header.join(",")];
  for (const r of report.rows) {
    lines.push(
      [
        r.external_id,
        r.reviewer_decision,
        r.ormes_decision ?? "",
        outcomeOf(r),
        r.lab_outcome ?? "",
        Math.round(r.reviewer_minutes * 100) / 100,
        r.duration_s === null ? null : Math.round(r.duration_s * 10) / 10,
        r.reasons.join("; "),
        moments.get(r.external_id) ?? "",
      ]
        .map(csvCell)
        .join(","),
    );
  }
  return `${lines.join("\r\n")}\r\n`;
}

export const VERDICT_TEXT: Record<PilotReport["verdict"], string> = {
  pass: "PASS: every success criterion is met",
  fail: "FAIL: at least one success criterion is not met",
  not_measurable: "NOT MEASURABLE: some criteria need more data",
  provisional: "PROVISIONAL: videos are still being analysed",
};

// The standard PDF fonts only cover Latin-1: replace the few typographic characters we use.
function latin1(s: string): string {
  return s
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—−]/g, "-")
    .replace(/→/g, "->")
    .replace(/·/g, "-")
    .replace(/…/g, "...")
    .replace(/[^\x20-\x7E\xA0-\xFF]/g, "?");
}

class Writer {
  page!: PDFPage;
  y = 0;
  constructor(
    private doc: PDFDocument,
    private font: PDFFont,
    private bold: PDFFont,
  ) {
    this.newPage();
  }
  static readonly W = 595.28;
  static readonly H = 841.89;
  static readonly M = 48;
  newPage() {
    this.page = this.doc.addPage([Writer.W, Writer.H]);
    this.y = Writer.H - Writer.M;
  }
  ensure(h: number) {
    if (this.y - h < Writer.M) this.newPage();
  }
  wrap(text: string, size: number, width: number, font = this.font): string[] {
    const words = latin1(text).split(/\s+/);
    const out: string[] = [];
    let line = "";
    for (const w of words) {
      const next = line ? `${line} ${w}` : w;
      if (font.widthOfTextAtSize(next, size) > width && line) {
        out.push(line);
        line = w;
      } else line = next;
    }
    if (line) out.push(line);
    return out;
  }
  text(text: string, opts: { size?: number; bold?: boolean; color?: [number, number, number]; gap?: number; indent?: number } = {}) {
    const size = opts.size ?? 10;
    const font = opts.bold ? this.bold : this.font;
    const x = Writer.M + (opts.indent ?? 0);
    for (const line of this.wrap(text, size, Writer.W - Writer.M - x, font)) {
      this.ensure(size + 4);
      this.page.drawText(line, { x, y: this.y - size, size, font, color: rgb(...(opts.color ?? [0.1, 0.1, 0.12])) });
      this.y -= size + 4;
    }
    this.y -= opts.gap ?? 2;
  }
  heading(text: string) {
    this.ensure(40);
    this.y -= 10;
    this.text(text, { size: 13, bold: true, gap: 4 });
  }
  table(header: string[], rows: string[][], widths: number[]) {
    const size = 9;
    const draw = (cells: string[], bold: boolean) => {
      const lines = cells.map((c, i) => this.wrap(c, size, widths[i] - 6, bold ? this.bold : this.font));
      const h = Math.max(...lines.map((l) => l.length)) * (size + 3) + 4;
      this.ensure(h);
      let x = Writer.M;
      cells.forEach((_, i) => {
        lines[i].forEach((l, j) => {
          this.page.drawText(l, { x, y: this.y - size - j * (size + 3), size, font: bold ? this.bold : this.font, color: rgb(0.1, 0.1, 0.12) });
        });
        x += widths[i];
      });
      this.y -= h;
      this.page.drawLine({ start: { x: Writer.M, y: this.y + 2 }, end: { x: Writer.W - Writer.M, y: this.y + 2 }, thickness: 0.4, color: rgb(0.85, 0.86, 0.88) });
    };
    draw(header, true);
    for (const r of rows) draw(r, false);
    this.y -= 6;
  }
}

/** A printable report for the collector and their lab: verdict first, then the evidence. */
export async function pilotToPdf(meta: PilotMeta, report: PilotReport): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(`Ormes pilot report: ${latin1(meta.name)}`);
  doc.setProducer("Ormes");
  doc.setCreator("Ormes");
  const w = new Writer(doc, await doc.embedFont(StandardFonts.Helvetica), await doc.embedFont(StandardFonts.HelveticaBold));

  w.text("ORMES SHADOW PILOT", { size: 9, bold: true, color: [0.35, 0.38, 0.42] });
  w.text(meta.name, { size: 20, bold: true, gap: 4 });
  w.text(`Rubric ${meta.rubric_name} v${meta.rubric_version} - ${report.counts.videos} videos - generated ${report.generated_at.slice(0, 16).replace("T", " ")} UTC`, {
    size: 9,
    color: [0.35, 0.38, 0.42],
    gap: 10,
  });
  const color: [number, number, number] = report.verdict === "pass" ? [0.05, 0.45, 0.25] : report.verdict === "fail" ? [0.7, 0.12, 0.12] : [0.45, 0.35, 0.05];
  w.text(VERDICT_TEXT[report.verdict], { size: 14, bold: true, color, gap: 6 });
  w.text("Ormes ran in shadow mode next to your reviewers: no webhooks, nothing sent to contributors. Every figure compares Ormes with the decisions your reviewers had already made.", {
    size: 9,
    color: [0.35, 0.38, 0.42],
  });

  w.heading("Success criteria (agreed before the run)");
  w.table(
    ["Criterion", "Result", "Measured"],
    report.criteria.map((c) => [describeCriterion(c.criterion), c.verdict === "not_measurable" ? "not measurable" : c.verdict.toUpperCase(), c.detail]),
    [250, 80, 169],
  );

  w.heading("Key figures");
  w.table(
    ["Figure", "Value"],
    [
      ["Videos decided", `${report.counts.decided} of ${report.counts.videos}${report.counts.pending ? ` (${report.counts.pending} still running)` : ""}${report.counts.failed ? `, ${report.counts.failed} failed` : ""}${report.counts.missing_file ? `, ${report.counts.missing_file} without a file` : ""}`],
      [METRICS.automatic_rate.label, pct(report.metrics.automatic_rate)],
      ["Agreement on automatic decisions", pct(report.metrics.agreement)],
      [METRICS.false_accept_rate.label, pct(report.metrics.false_accept_rate)],
      [METRICS.false_reject_rate.label, pct(report.metrics.false_reject_rate)],
      [METRICS.rejection_precision.label, pct(report.metrics.rejection_precision)],
      [METRICS.rejection_recall.label, pct(report.metrics.rejection_recall)],
      ["Your reviewers' reject rate (base rate)", pct(report.metrics.reviewer_reject_rate)],
      ["Review minutes (before -> with Ormes)", `${num1(report.minutes.before)} -> ${num1(report.minutes.after)} (saved ${num1(report.minutes.saved)})`],
      ["Per video-hour", `${num1(report.minutes.per_hour_before)} -> ${num1(report.minutes.per_hour_after)} (${signed(report.metrics.review_minutes_change)})`],
    ],
    [250, 249],
  );
  w.text(`Minutes are your reviewers' own where the CSV gives them, otherwise ${num1(report.minutes.assumed_minutes)} per video. With Ormes, people only review what Ormes sends to review.`, {
    size: 8,
    color: [0.35, 0.38, 0.42],
  });

  w.heading("Ormes vs your reviewers");
  const c = report.confusion;
  w.table(
    ["Ormes \\ Reviewers", "Accepted", "Rejected"],
    [
      ["Accepted", String(c.accept.accept), `${c.accept.reject} (false accepts)`],
      ["Rejected", `${c.reject.accept} (false rejects)`, String(c.reject.reject)],
      ["Sent to review", String(c.review.accept), String(c.review.reject)],
    ],
    [170, 165, 164],
  );

  if (report.lab.videos) {
    w.heading("Against the lab's outcome");
    w.table(
      ["", "Your reviewers", "With Ormes"],
      [
        ["False accepts", pct(report.lab.reviewer_false_accept_rate), pct(report.lab.with_ormes_false_accept_rate)],
        ["False rejects", pct(report.lab.reviewer_false_reject_rate), pct(report.lab.with_ormes_false_reject_rate)],
      ],
      [170, 165, 164],
    );
    w.text(`${report.lab.videos} videos with a lab outcome. "With Ormes" uses your reviewers' decision for the videos Ormes sent to review.`, { size: 8, color: [0.35, 0.38, 0.42] });
  }

  if (report.checks.length) {
    w.heading("Per check");
    w.table(
      ["Check", "Flagged on videos you rejected", "Flagged on videos you accepted"],
      report.checks.map((k) => [k.label, `${k.flagged_on_rejected} of ${k.rejected} (${pct(k.rejected ? k.flagged_on_rejected / k.rejected : null)})`, `${k.flagged_on_accepted} of ${k.accepted} (${pct(k.accepted ? k.flagged_on_accepted / k.accepted : null)})`]),
      [170, 165, 164],
    );
  }

  w.heading("Duplicates");
  w.text(
    report.duplicates.items.length
      ? `${report.duplicates.items.length} videos repeat an earlier one: ${report.duplicates.across_contributors} from a different contributor, ${report.duplicates.same_contributor} from the same contributor, ${report.duplicates.unknown} with no contributor id.`
      : "No duplicates found.",
  );

  w.heading(`Disagreements to inspect (${report.disagreements.length})`);
  if (!report.disagreements.length) w.text("None: every automatic decision matched your reviewers.");
  for (const d of report.disagreements.slice(0, 60)) {
    w.text(`${d.external_id}: reviewers ${d.reviewer}, Ormes ${d.ormes} (${d.kind === "false_accept" ? "false accept" : "false reject"})`, { bold: true, size: 9.5, gap: 0 });
    const where = d.moments.map((m) => `${m.t ?? "whole video"} ${m.label}`).join("; ");
    w.text(where || (d.reasons.join(", ") || "No reason recorded: Ormes found nothing wrong."), { size: 9, indent: 10, color: [0.3, 0.32, 0.36], gap: 4 });
  }
  if (report.disagreements.length > 60) w.text(`${report.disagreements.length - 60} more in the CSV export.`, { size: 9 });

  return doc.save();
}
