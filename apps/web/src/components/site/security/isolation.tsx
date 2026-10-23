import { Ban, Building2, Fingerprint, KeyRound, Scale, Signature } from "lucide-react";
import { cn } from "@/lib/utils";
import { ICON } from "../primitives";

const ORGS = [
  { name: "Northwind Capture", decisions: 1284, prints: 24, you: true },
  { name: "Organisation B", decisions: 902, prints: 18 },
  { name: "Organisation C", decisions: 517, prints: 12 },
];

function Wall({ blocked }: { blocked?: boolean }) {
  return (
    <div aria-hidden className="relative flex items-center justify-center md:w-10 md:flex-col">
      <span className="h-3 w-full rounded-sm bg-[repeating-linear-gradient(135deg,rgba(255,255,255,0.16)_0_4px,transparent_4px_9px)] md:h-full md:w-3" />
      {blocked ? (
        <span className="absolute inline-flex size-7 items-center justify-center rounded-full border border-no/50 bg-background text-no">
          <Ban {...ICON} className="size-3.5" />
        </span>
      ) : null}
    </div>
  );
}

/** Security §3: three organisations with walls between them. Nothing crosses. */
export function Isolation() {
  return (
    <div>
      <div className="flex flex-col gap-3 md:flex-row md:items-stretch md:gap-0">
        {ORGS.map((org, i) => (
          <div key={org.name} className="contents">
            {i > 0 ? <Wall blocked={i === 1} /> : null}
            <div className={cn("flex-1 rounded-[20px] border p-5", org.you ? "border-brand/40 bg-brand/[0.05]" : "border-hairline bg-panel")}>
              <p className="flex items-center gap-2 text-[15px] font-medium">
                <Building2 {...ICON} className={cn("size-4", org.you ? "text-brand" : "text-muted-foreground")} />
                {org.name}
                {org.you ? <span className="ml-auto rounded-full bg-brand/12 px-2 py-px text-[12px] text-brand">You</span> : null}
              </p>
              <dl className="mt-5 flex flex-col gap-3 text-[13.5px]">
                <div className="flex items-center justify-between">
                  <dt className="inline-flex items-center gap-2 text-muted-foreground">
                    <Scale {...ICON} className="size-4" /> Decisions
                  </dt>
                  <dd className="tabular font-mono">{org.decisions.toLocaleString("en-US")}</dd>
                </div>
                <div>
                  <dt className="inline-flex items-center gap-2 text-muted-foreground">
                    <Fingerprint {...ICON} className="size-4" /> Fingerprints
                  </dt>
                  <dd aria-hidden className="mt-2.5 flex flex-wrap gap-1.5">
                    {Array.from({ length: org.prints }, (_, k) => (
                      <i key={k} className={cn("size-2 rounded-full", org.you ? "bg-brand/70" : "bg-foreground/25")} style={{ opacity: 0.45 + ((k * 37) % 55) / 100 }} />
                    ))}
                  </dd>
                </div>
              </dl>
            </div>
          </div>
        ))}
      </div>
      <p className="mt-4 text-[13px] text-muted-foreground">Example organisations</p>
      <ul className="mt-8 grid gap-6 md:grid-cols-3">
        <li className="flex gap-3">
          <Fingerprint {...ICON} className="mt-0.5 size-5 shrink-0 text-brand" />
          <p className="text-[15px] leading-relaxed text-muted-foreground">
            <b className="font-medium text-foreground">Row-level security</b> on every table, scoped to your organisation. Duplicate matching only compares a video with
            your own earlier videos.
          </p>
        </li>
        <li className="flex gap-3">
          <KeyRound {...ICON} className="mt-0.5 size-5 shrink-0 text-brand" />
          <p className="text-[15px] leading-relaxed text-muted-foreground">
            <b className="font-medium text-foreground">Keys stored as hashes.</b> API keys and webhook secrets are shown once; we keep only a SHA-256 hash of each API key.
          </p>
        </li>
        <li className="flex gap-3">
          <Signature {...ICON} className="mt-0.5 size-5 shrink-0 text-brand" />
          <p className="text-[15px] leading-relaxed text-muted-foreground">
            <b className="font-medium text-foreground">Signed webhooks.</b> HMAC-SHA256 with a timestamp, so you can reject forged or replayed requests.
          </p>
        </li>
      </ul>
    </div>
  );
}
