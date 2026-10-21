import { PublicPage } from "@/components/public-page";

export const metadata = { title: "Data processing agreement (draft) · Quellix" };

export default function DpaPage() {
  return (
    <PublicPage title="Data processing agreement">
      <p className="rounded-md border border-amber-300 bg-amber-50 p-3 font-medium text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200">
        Draft, to be reviewed by counsel. This template is not a legal commitment until it is reviewed, completed and signed.
      </p>

      <h2>1. Parties and roles</h2>
      <p>
        The customer (the data collector) is the controller of the videos it uploads. Quellix acts as processor and
        processes them only on the customer&apos;s documented instructions.
      </p>

      <h2>2. Purpose</h2>
      <p>
        Analysing uploaded videos against the customer&apos;s rubric and returning a decision, reasons and measurements.
      </p>

      <h2>3. Retention and deletion</h2>
      <p>Uploaded video files are deleted after analysis. Decisions, reasons and measurements are kept in the customer&apos;s account until it deletes them or ends the contract.</p>

      <h2>4. No training without opt-in</h2>
      <p>Customer videos are not used to train models unless the customer has opted in for its organization.</p>

      <h2>5. Customer isolation</h2>
      <p>Fingerprints used for duplicate detection are scoped to the customer that produced them. There is no cross-customer matching.</p>

      <h2>6. Sub-processors</h2>
      <ul>
        <li>Supabase (database, authentication, storage)</li>
        <li>Vercel (hosting)</li>
        <li>Modal (compute)</li>
        <li>Google Gemini and TwelveLabs, only if enabled for the customer&apos;s tasks</li>
      </ul>

      <h2>7. Security</h2>
      <p>Access is limited to the customer&apos;s organization members. API keys are stored only as hashes.</p>

      <h2>8. Open points for counsel</h2>
      <ul>
        <li>Governing law, liability and international transfer mechanism.</li>
        <li>Breach notification timeline.</li>
        <li>Audit rights and sub-processor change notice period.</li>
        <li>Contact details of both parties.</li>
      </ul>
    </PublicPage>
  );
}
