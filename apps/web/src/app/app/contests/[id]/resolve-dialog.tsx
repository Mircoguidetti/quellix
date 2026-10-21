"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Gavel } from "lucide-react";
import { FormAlert } from "@/components/auth/form-alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioCard, RadioGroup } from "@/components/ui/radio-group";
import { resolveContestAction } from "../actions";

export function ResolveDialog({ contestId }: { contestId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<"upheld" | "overturned" | "">("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (!status) return setError("Choose an outcome.");
    setSaving(true);
    setError(null);
    const res = await resolveContestAction(contestId, { status, note: note.trim() || undefined }).catch(() => ({ ok: false as const, error: "We could not reach Quellix." }));
    setSaving(false);
    if (!res.ok) return setError(res.error);
    setOpen(false);
    toast.success(status === "overturned" ? "Rejection overturned" : "Rejection upheld");
    router.refresh();
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !saving && setOpen(o)}>
      <DialogTrigger asChild>
        <Button>
          <Gavel aria-hidden />
          Resolve
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Resolve this contest</DialogTitle>
          <DialogDescription>Your decision is final and recorded with your name. Write a note the team can read later.</DialogDescription>
        </DialogHeader>
        <RadioGroup value={status} onValueChange={(v) => setStatus(v as "upheld" | "overturned")} aria-label="Outcome">
          <RadioCard value="overturned" title="Overturn the rejection" description="The contributor was right. Treat the video as accepted and pay them." />
          <RadioCard value="upheld" title="Uphold the rejection" description="The video does not meet the spec. The rejection stands." />
        </RadioGroup>
        <div className="grid gap-1.5">
          <Label htmlFor="resolution-note">
            Note <span className="font-normal text-muted-foreground">(optional)</span>
          </Label>
          <Textarea id="resolution-note" rows={3} maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} placeholder="What you checked and why you decided this way." />
        </div>
        {error && <FormAlert>{error}</FormAlert>}
        <DialogFooter>
          <Button variant="secondary" onClick={() => setOpen(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={submit} loading={saving}>
            Save resolution
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
