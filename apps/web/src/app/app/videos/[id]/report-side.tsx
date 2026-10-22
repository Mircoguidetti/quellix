"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check, X } from "lucide-react";
import { DecisionBadge } from "@/components/app/decision-badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input, Textarea } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { overrideDecision, saveLabOutcome } from "./actions";

type Props = {
  videoId: string;
  decision: string | null;
  review: { decision: string; note: string | null } | null;
  lab: { outcome: "accept" | "reject"; reason: string } | null;
};

export function ReportSide({ videoId, decision, review, lab }: Props) {
  const router = useRouter();
  const [note, setNote] = useState("");
  const [pending, setPending] = useState<"accept" | "reject" | null>(null);
  const [outcome, setOutcome] = useState<"accept" | "reject" | undefined>(lab?.outcome);
  const [reason, setReason] = useState(lab?.reason ?? "");
  const [labPending, startLab] = useTransition();

  const decide = async (value: "accept" | "reject") => {
    setPending(value);
    const res = await overrideDecision(videoId, { decision: value, note: note.trim() || undefined }).catch(() => ({ ok: false as const, error: "We could not reach Ormes." }));
    setPending(null);
    if (!res.ok) return toast.error(res.error);
    toast.success(value === "accept" ? "Marked as accepted" : "Marked as rejected");
    setNote("");
    router.refresh();
  };

  return (
    <aside className="grid content-start gap-4">
      {decision && (
      <Card className="grid gap-3 p-4">
        <div>
          <h2 className="text-[14px] font-medium">{review ? "Human decision" : decision === "review" ? "Decide this video" : "Override the decision"}</h2>
          <p className="mt-1 text-[13px] text-muted-foreground">
            {review ? (
              <span className="inline-flex items-center gap-1.5">
                A reviewer decided <DecisionBadge value={review.decision} />
              </span>
            ) : decision === "review" ? (
              "Ormes could not decide. Your answer is final."
            ) : (
              "Reviewers can override any automatic decision."
            )}
          </p>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="override-note" className="text-[13px]">
            Note <span className="font-normal text-muted-foreground">(optional)</span>
          </Label>
          <Textarea id="override-note" rows={2} maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Button variant="reject" loading={pending === "reject"} disabled={pending !== null} onClick={() => decide("reject")}>
            <X aria-hidden />
            Reject
          </Button>
          <Button variant="accept" loading={pending === "accept"} disabled={pending !== null} onClick={() => decide("accept")}>
            <Check aria-hidden />
            Accept
          </Button>
        </div>
      </Card>
      )}

      <Card className="grid gap-3 p-4">
        <div>
          <h2 className="text-[14px] font-medium">Lab outcome</h2>
          <p className="mt-1 text-[13px] text-muted-foreground">What the lab decided. We use it to measure rejection precision and recall.</p>
        </div>
        <form
          className="grid gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (!outcome) return void toast.error("Choose what the lab decided.");
            startLab(async () => {
              const res = await saveLabOutcome(videoId, { outcome, reason: reason.trim() || undefined }).catch(() => ({ ok: false as const, error: "We could not reach Ormes." }));
              if (res.ok) toast.success("Lab outcome saved");
              else toast.error(res.error);
            });
          }}
        >
          <div className="grid gap-1.5">
            <Label htmlFor="lab-outcome" className="text-[13px]">
              Outcome
            </Label>
            <Select value={outcome} onValueChange={(v) => setOutcome(v as "accept" | "reject")}>
              <SelectTrigger id="lab-outcome">
                <SelectValue placeholder="Not recorded yet" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="accept">Lab accepted</SelectItem>
                <SelectItem value="reject">Lab rejected</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="lab-reason" className="text-[13px]">
              Reason <span className="font-normal text-muted-foreground">(optional)</span>
            </Label>
            <Input id="lab-reason" maxLength={2000} value={reason} onChange={(e) => setReason(e.target.value)} />
          </div>
          <Button type="submit" variant="secondary" loading={labPending}>
            {lab ? "Update lab outcome" : "Save lab outcome"}
          </Button>
        </form>
      </Card>
    </aside>
  );
}
