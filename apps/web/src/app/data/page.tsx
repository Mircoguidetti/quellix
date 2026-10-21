import { PublicPage } from "@/components/public-page";

export const metadata = { title: "How we handle your data" };

export default function DataPage() {
  return (
    <PublicPage title="How we handle your data">
      <p>Quellix analyses the videos you upload and returns a decision with reasons. This page says what happens to them.</p>

      <h2>Videos are analysed, then deleted</h2>
      <p>
        A video is kept only while it is being analysed and while it waits in your review list, so a person can watch it:
        at most 14 days, then it is deleted even if nobody reviewed it. A video that fails processing is deleted after the
        last attempt. Decisions, reasons and measurements stay in your account.
      </p>

      <h2>No training without your opt-in</h2>
      <p>
        Your videos are never used to train models unless your organization has explicitly opted in. The setting is off by
        default and belongs to your organization.
      </p>

      <h2>Third-party models are off by default</h2>
      <p>
        Google Gemini and TwelveLabs only ever see your videos if an owner or admin of your organization turns on
        &ldquo;Allow third-party models to analyse our videos&rdquo; in settings. The switch is off by default and you can turn it
        off again at any time.
      </p>

      <h2>Your data stays yours</h2>
      <p>Duplicate detection compares a video only with your own organization&apos;s earlier videos. We do not match across customers.</p>

      <h2>Sub-processors</h2>
      <ul>
        <li>Supabase: database, authentication and file storage.</li>
        <li>Vercel: hosting of the web app and API.</li>
        <li>Modal: compute for video analysis.</li>
        <li>Google Gemini: only when your organization turns on third-party models in its settings.</li>
        <li>TwelveLabs: only when your organization turns on third-party models in its settings.</li>
      </ul>

      <h2>Questions</h2>
      <p>
        See the <a href="/dpa">data processing agreement</a> (draft) for the terms we propose.
      </p>
    </PublicPage>
  );
}
