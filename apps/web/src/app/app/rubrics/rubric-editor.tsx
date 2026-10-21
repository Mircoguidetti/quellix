"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useForm, useWatch, type Control, type FieldPath } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { CircleCheck, CircleDot, CircleX, History, Lock, Save, TriangleAlert } from "lucide-react";
import { FormAlert } from "@/components/auth/form-alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input, Textarea } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { formatDate } from "@/lib/format";
import { validateRubric } from "@/lib/rubric";
import { CHECK_NAMES, evaluate, outputsFromStoredChecks, checkConfig } from "@/lib/rubric-eval";
import { rubricFormSchema, summarizeRules, toFormValues, toRubricInput, type RubricFormValues } from "@/lib/rubric-form";
import { cn } from "@/lib/utils";
import { saveRubric } from "./actions";

type Body = { name: string; task: Record<string, unknown>; checks: Record<string, unknown> };
type Sample = { decision: string; checks: Record<string, { status?: string; measurements?: Record<string, unknown>; model?: string }> };
type Version = { version: number; created_at: string; body: Body & { version: number } };

type Props = {
  rubricId: string | null;
  currentVersion: number | null;
  initial: Body;
  history: Version[];
  samples: Sample[];
  sampleScope: "rubric" | "organization";
  canEdit: boolean;
};

export function RubricEditor({ rubricId, currentVersion, initial, history, samples, sampleScope, canEdit }: Props) {
  const router = useRouter();
  const form = useForm<RubricFormValues>({ resolver: zodResolver(rubricFormSchema), defaultValues: toFormValues(initial), mode: "onChange" });
  const values = useWatch({ control: form.control }) as RubricFormValues;
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [loadedVersion, setLoadedVersion] = useState<number | null>(null);

  const input = useMemo(() => toRubricInput(values), [values]);
  const problems = useMemo(() => validateRubric({ id: rubricId ?? "new", version: (currentVersion ?? 0) + 1, ...input }), [input, rubricId, currentVersion]);
  const preview = useMemo(() => previewOn(samples, input), [samples, input]);
  const rules = useMemo(() => summarizeRules(values), [values]);
  const nextVersion = (currentVersion ?? 0) + 1;
  const dirty = form.formState.isDirty || loadedVersion !== null;

  const openConfirm = form.handleSubmit(
    () => {
      if (problems.length) return toast.error("The rubric does not match the schema yet. See Validation.");
      setSaveError(null);
      setConfirming(true);
    },
    () => toast.error("Fix the highlighted fields first."),
  );

  const save = async () => {
    setSaving(true);
    setSaveError(null);
    const res = await saveRubric(rubricId, input).catch(() => ({ ok: false as const, error: "We could not reach Quellix. Try again." }));
    setSaving(false);
    if (!res.ok) return setSaveError(res.error);
    setConfirming(false);
    toast.success(rubricId ? `Saved version ${res.version}` : "Rubric created");
    form.reset(values);
    setLoadedVersion(null);
    router.push(`/app/rubrics/${res.id}`);
    router.refresh();
  };

  return (
    <Form {...form}>
      <form onSubmit={(e) => e.preventDefault()} noValidate className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
        <fieldset disabled={!canEdit} className="grid min-w-0 content-start gap-4">
          {!canEdit && (
            <FormAlert tone="info">
              <span className="inline-flex items-center gap-1.5">
                <Lock className="size-3.5" aria-hidden />
                Only owners and admins can change rubrics. You are viewing it read-only.
              </span>
            </FormAlert>
          )}
          <Section title="Task" description="What the contributor films. Copy it from the lab's spec.">
            <div className="grid gap-4 sm:grid-cols-2">
              <TextField control={form.control} name="name" label="Rubric name" placeholder="Load the dishwasher" />
              <TextField
                control={form.control}
                name="task.library_id"
                label="Task library id"
                placeholder="load_dishwasher"
                description="Optional. Uses our specialised task model; without it a general model judges completion."
                mono
              />
            </div>
            <TextField control={form.control} name="task.description" label="Task description" multiline placeholder="Load dirty plates and glasses into the dishwasher and close the door." />
            <div className="grid gap-4 sm:grid-cols-2">
              <TextField control={form.control} name="task.steps" label="Steps" multiline description="One per line, in order." />
              <TextField control={form.control} name="task.final_state" label="Final state" multiline description="What the scene looks like when the task is done." />
            </div>
          </Section>

          <CheckSection control={form.control} name="task_completed" title="Task completed" help="Did the contributor finish the task described above?" critical>
            <SliderField control={form.control} name="checks.task_completed.min_confidence" label="Minimum confidence" help="Below this, the video goes to review instead of being decided." />
          </CheckSection>

          <CheckSection control={form.control} name="hands_visible" title="Hands visible" help="Hands fully in frame, wrist to fingertips, not cut by the edge." critical>
            <SliderField control={form.control} name="checks.hands_visible.min_ratio" label="Minimum time visible" help="Share of frames where the hands are fully visible." />
            <div className="grid gap-4 sm:grid-cols-2">
              <SelectField
                control={form.control}
                name="checks.hands_visible.scope"
                label="Measured over"
                options={[
                  ["manipulation", "Only while handling objects"],
                  ["whole_video", "The whole video"],
                ]}
              />
              <SwitchField control={form.control} name="checks.hands_visible.require_both" label="Both hands required" help="Off: one hand in frame is enough." />
            </div>
          </CheckSection>

          <CheckSection control={form.control} name="framing" title="Framing and stability" help="Camera pointed at the work and steady." critical>
            <SliderField control={form.control} name="checks.framing.max_off_target_ratio" label="Maximum time off target" help="Share of frames where the camera points away from the work." />
            <SliderField control={form.control} name="checks.framing.max_unstable_ratio" label="Maximum unstable time" help="Share of frames with a shaking or jumping camera." />
          </CheckSection>

          <CheckSection control={form.control} name="technical" title="Technical quality" help="Length, resolution, frame rate, blur and exposure." critical>
            <div className="grid gap-4 sm:grid-cols-2">
              <NumberField control={form.control} name="checks.technical.min_duration_s" label="Minimum duration" unit="s" />
              <NumberField control={form.control} name="checks.technical.max_duration_s" label="Maximum duration" unit="s" />
              <NumberField control={form.control} name="checks.technical.min_width" label="Minimum width" unit="px" step={1} />
              <NumberField control={form.control} name="checks.technical.min_height" label="Minimum height" unit="px" step={1} />
              <NumberField control={form.control} name="checks.technical.min_fps" label="Minimum frame rate" unit="fps" />
            </div>
            <SliderField control={form.control} name="checks.technical.max_blur_ratio" label="Maximum blurry frames" />
            <SliderField control={form.control} name="checks.technical.max_bad_exposure_ratio" label="Maximum too dark or bright" />
          </CheckSection>

          <CheckSection control={form.control} name="privacy" title="Privacy" help="What to do when personal data is visible. Doubtful cases should go to review.">
            <div className="grid gap-4 sm:grid-cols-3">
              {(
                [
                  ["faces", "Faces"],
                  ["documents", "Readable documents"],
                  ["screens", "Readable screens"],
                ] as const
              ).map(([k, label]) => (
                <SelectField
                  key={k}
                  control={form.control}
                  name={`checks.privacy.${k}`}
                  label={label}
                  options={[
                    ["review", "Send to review"],
                    ["reject", "Reject"],
                    ["ignore", "Ignore"],
                  ]}
                />
              ))}
            </div>
          </CheckSection>

          <CheckSection control={form.control} name="originality" title="Originality" help="Matches against videos your organization received before. Never across customers.">
            <SliderField
              control={form.control}
              name="checks.originality.similarity_threshold"
              label="Similarity threshold"
              help="At or above this, the video counts as already delivered."
              format={(v) => v.toFixed(2)}
            />
            <SelectField
              control={form.control}
              name="checks.originality.on_duplicate"
              label="When it is a duplicate"
              options={[
                ["reject", "Reject"],
                ["review", "Send to review"],
              ]}
            />
          </CheckSection>
        </fieldset>

        <aside className="grid content-start gap-4 xl:sticky xl:top-6 xl:max-h-[calc(100dvh-3rem)] xl:overflow-y-auto xl:pb-2">
          <Card className="grid gap-3 p-4">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-[14px] font-medium">{rubricId ? `Version ${currentVersion}` : "New rubric"}</h2>
              {dirty && <Badge tone="review">unsaved changes</Badge>}
            </div>
            <p className="text-[13px] text-muted-foreground">
              {rubricId
                ? `Saving creates version ${nextVersion}. Videos already decided keep the version they used.`
                : "Saving creates version 1. Uploads choose it by name."}
            </p>
            <Button type="button" onClick={openConfirm} disabled={!canEdit}>
              <Save aria-hidden />
              {rubricId ? `Save as version ${nextVersion}` : "Create rubric"}
            </Button>
          </Card>

          <Card className="grid gap-4 p-4">
            <div>
              <h2 className="text-[14px] font-medium">Live preview</h2>
              <p className="mt-1 text-[13px] text-muted-foreground">
                {preview.compared
                  ? `These settings applied to the last ${preview.compared} decided videos${sampleScope === "organization" ? " of your organization" : ""}.`
                  : "No decided videos yet to preview on."}
              </p>
            </div>
            {preview.compared > 0 && (
              <>
                <dl className="grid grid-cols-3 gap-2">
                  {(["accept", "review", "reject"] as const).map((k) => (
                    <div key={k} className="rounded-lg border border-border p-2.5">
                      <dt className="font-mono text-[11px] uppercase tracking-[0.06em] text-muted-foreground">{k}</dt>
                      <dd className="mt-1 text-[20px] font-medium leading-none tabular-nums">{preview.next[k]}</dd>
                      <dd className={cn("mt-1 font-mono text-[11.5px] tabular-nums", delta(preview.next[k], preview.now[k]).tone)}>
                        {delta(preview.next[k], preview.now[k]).text}
                      </dd>
                    </div>
                  ))}
                </dl>
                <p className="text-[13px]">
                  {preview.changed ? (
                    <>
                      <span className="font-medium tabular-nums">{preview.changed}</span> of {preview.compared} decisions would change.
                    </>
                  ) : (
                    "No decision would change."
                  )}
                  {preview.skipped > 0 && <span className="text-muted-foreground"> {preview.skipped} could not be compared because a check was off when they were analysed.</span>}
                </p>
              </>
            )}
            <RuleList icon={CircleX} tone="text-reject-fg" title="Rejects when" items={rules.rejects} />
            <RuleList icon={CircleDot} tone="text-review-fg" title="Sends to review when" items={rules.reviews} />
            {rules.off.length > 0 && <p className="text-[12.5px] text-muted-foreground">Off: {rules.off.join(", ")}.</p>}
          </Card>

          <Card className="grid gap-2 p-4">
            <h2 className="text-[14px] font-medium">Validation</h2>
            {problems.length === 0 ? (
              <p className="flex items-center gap-1.5 text-[13px] text-accept-fg">
                <CircleCheck className="size-4" aria-hidden />
                Matches the rubric schema.
              </p>
            ) : (
              <ul className="grid gap-1 text-[13px] text-reject-fg">
                {problems.map((p) => (
                  <li key={p} className="flex gap-1.5">
                    <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                    <span className="font-mono text-[12px]">{p}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {history.length > 0 && (
            <Card className="grid gap-2 p-4">
              <h2 className="flex items-center gap-1.5 text-[14px] font-medium">
                <History className="size-4 text-muted-foreground" aria-hidden />
                Version history
              </h2>
              <ol className="grid">
                {history.map((v) => (
                  <li key={v.version} className="flex items-center justify-between gap-2 border-t border-border py-2 first:border-t-0">
                    <span className="text-[13px]">
                      <span className="font-mono font-medium">v{v.version}</span>
                      <span className="text-muted-foreground"> · {formatDate(v.created_at)}</span>
                      {v.version === currentVersion && <span className="text-muted-foreground"> · current</span>}
                      {v.version === loadedVersion && <span className="text-accent-foreground"> · in editor</span>}
                    </span>
                    {canEdit && v.version !== currentVersion && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          form.reset(toFormValues(v.body), { keepDefaultValues: true });
                          setLoadedVersion(v.version);
                          toast(`Version ${v.version} loaded into the editor`, { description: `Save to make it version ${nextVersion}.` });
                        }}
                      >
                        Restore
                      </Button>
                    )}
                  </li>
                ))}
              </ol>
            </Card>
          )}
        </aside>

        <Dialog open={confirming} onOpenChange={(o) => !saving && setConfirming(o)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{rubricId ? `Save as version ${nextVersion}?` : `Create “${values.name}”?`}</DialogTitle>
              <DialogDescription>
                {rubricId
                  ? `New uploads will use version ${nextVersion}. Videos already decided keep version ${currentVersion}, so their decisions stay explainable.`
                  : "New uploads can use this rubric as soon as it is saved."}
              </DialogDescription>
            </DialogHeader>
            {preview.compared > 0 && (
              <p className="rounded-lg bg-subtle px-3 py-2.5 text-[13.5px]">
                On the last {preview.compared} videos: <b className="font-medium tabular-nums">{preview.next.reject}</b> rejected,{" "}
                <b className="font-medium tabular-nums">{preview.next.review}</b> to review, <b className="font-medium tabular-nums">{preview.next.accept}</b> accepted
                {preview.changed ? ` (${preview.changed} different from today).` : "."}
              </p>
            )}
            {saveError && <FormAlert>{saveError}</FormAlert>}
            <DialogFooter>
              <Button type="button" variant="secondary" onClick={() => setConfirming(false)} disabled={saving}>
                Keep editing
              </Button>
              <Button type="button" onClick={save} loading={saving}>
                {rubricId ? `Save version ${nextVersion}` : "Create rubric"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </form>
    </Form>
  );
}

function previewOn(samples: Sample[], input: Body) {
  const now = { accept: 0, review: 0, reject: 0 };
  const next = { accept: 0, review: 0, reject: 0 };
  let changed = 0;
  let skipped = 0;
  for (const s of samples) {
    const outputs = outputsFromStoredChecks(s.checks);
    const missing = CHECK_NAMES.some((name) => checkConfig(input, name).enabled !== false && !outputs[name]);
    if (missing) {
      skipped++;
      continue;
    }
    const result = evaluate(input, outputs).decision;
    const before = s.decision as keyof typeof now;
    if (before in now) now[before]++;
    next[result]++;
    if (result !== before) changed++;
  }
  return { now, next, changed, skipped, compared: samples.length - skipped };
}

function delta(next: number, now: number): { text: string; tone: string } {
  const d = next - now;
  if (!d) return { text: "no change", tone: "text-muted-foreground" };
  return { text: `${d > 0 ? "+" : "−"}${Math.abs(d)} vs now`, tone: "text-foreground" };
}

function RuleList({ icon: Icon, tone, title, items }: { icon: typeof CircleX; tone: string; title: string; items: string[] }) {
  if (!items.length) return null;
  return (
    <div className="grid gap-1.5">
      <h3 className={cn("flex items-center gap-1.5 text-[13px] font-medium", tone)}>
        <Icon className="size-4" aria-hidden />
        {title}
      </h3>
      <ul className="grid gap-1 pl-[22px] text-[13px] text-muted-foreground">
        {items.map((t) => (
          <li key={t} className="list-disc">
            {t}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Section({ title, description, children, aside }: { title: string; description: string; children: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <Card className="grid gap-4 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-[15px] font-medium">{title}</h2>
          <p className="mt-0.5 text-[13px] text-muted-foreground">{description}</p>
        </div>
        {aside}
      </div>
      {children}
    </Card>
  );
}

type CheckKey = "task_completed" | "hands_visible" | "framing" | "technical" | "privacy" | "originality";

function CheckSection({
  control,
  name,
  title,
  help,
  critical = false,
  children,
}: {
  control: Control<RubricFormValues>;
  name: CheckKey;
  title: string;
  help: string;
  critical?: boolean;
  children: React.ReactNode;
}) {
  const enabled = useWatch({ control, name: `checks.${name}.enabled` });
  return (
    <Section
      title={title}
      description={help}
      aside={
        <div className="flex flex-wrap items-center gap-4">
          {critical && enabled && (
            <FormField
              control={control}
              name={`checks.${name}.critical` as FieldPath<RubricFormValues>}
              render={({ field }) => (
                <FormItem className="flex items-center gap-2 space-y-0">
                  <FormControl>
                    <Switch checked={field.value as boolean} onCheckedChange={field.onChange} />
                  </FormControl>
                  <FormLabel className="text-[13px] font-normal">
                    Critical <span className="text-muted-foreground">· {field.value ? "a failure rejects" : "a failure goes to review"}</span>
                  </FormLabel>
                </FormItem>
              )}
            />
          )}
          <FormField
            control={control}
            name={`checks.${name}.enabled` as FieldPath<RubricFormValues>}
            render={({ field }) => (
              <FormItem className="flex items-center gap-2 space-y-0">
                <FormControl>
                  <Switch checked={field.value as boolean} onCheckedChange={field.onChange} />
                </FormControl>
                <FormLabel className="text-[13px] font-normal">{field.value ? "On" : "Off"}</FormLabel>
              </FormItem>
            )}
          />
        </div>
      }
    >
      {enabled ? <div className="grid gap-5">{children}</div> : <p className="text-[13px] text-muted-foreground">This check does not run for this rubric.</p>}
    </Section>
  );
}

function TextField({
  control,
  name,
  label,
  description,
  placeholder,
  multiline,
  mono,
}: {
  control: Control<RubricFormValues>;
  name: FieldPath<RubricFormValues>;
  label: string;
  description?: string;
  placeholder?: string;
  multiline?: boolean;
  mono?: boolean;
}) {
  return (
    <FormField
      control={control}
      name={name}
      render={({ field }) => (
        <FormItem>
          <FormLabel>{label}</FormLabel>
          <FormControl>
            {multiline ? (
              <Textarea rows={3} placeholder={placeholder} {...field} value={(field.value as string) ?? ""} />
            ) : (
              <Input placeholder={placeholder} className={mono ? "font-mono text-[13px]" : undefined} {...field} value={(field.value as string) ?? ""} />
            )}
          </FormControl>
          {description && <FormDescription>{description}</FormDescription>}
          <FormMessage />
        </FormItem>
      )}
    />
  );
}

function SliderField({
  control,
  name,
  label,
  help,
  format = (v) => `${Math.round(v * 100)}%`,
}: {
  control: Control<RubricFormValues>;
  name: FieldPath<RubricFormValues>;
  label: string;
  help?: string;
  format?: (v: number) => string;
}) {
  return (
    <FormField
      control={control}
      name={name}
      render={({ field }) => (
        <FormItem className="gap-1.5">
          <div className="flex items-baseline justify-between gap-3">
            <FormLabel>{label}</FormLabel>
            <span className="rounded-md bg-muted px-1.5 font-mono text-[12.5px] leading-6 tabular-nums">{format(field.value as number)}</span>
          </div>
          <FormControl>
            <Slider
              min={0}
              max={1}
              step={0.01}
              value={[field.value as number]}
              onValueChange={([v]) => field.onChange(Math.round(v * 100) / 100)}
              aria-label={label}
              aria-valuetext={format(field.value as number)}
            />
          </FormControl>
          {help && <FormDescription>{help}</FormDescription>}
          <FormMessage />
        </FormItem>
      )}
    />
  );
}

function NumberField({
  control,
  name,
  label,
  unit,
  step,
}: {
  control: Control<RubricFormValues>;
  name: FieldPath<RubricFormValues>;
  label: string;
  unit: string;
  step?: number;
}) {
  return (
    <FormField
      control={control}
      name={name}
      render={({ field }) => (
        <FormItem>
          <FormLabel>{label}</FormLabel>
          <div className="relative">
            <FormControl>
              <Input
                type="number"
                inputMode="decimal"
                min={0}
                step={step ?? "any"}
                placeholder="No limit"
                className="pr-12 font-mono text-[13px] tabular-nums"
                name={field.name}
                ref={field.ref}
                onBlur={field.onBlur}
                value={field.value === undefined ? "" : String(field.value)}
                onChange={(e) => field.onChange(e.target.value === "" ? undefined : e.target.valueAsNumber)}
              />
            </FormControl>
            <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 font-mono text-[12px] text-muted-foreground">{unit}</span>
          </div>
          <FormMessage />
        </FormItem>
      )}
    />
  );
}

function SelectField({
  control,
  name,
  label,
  options,
}: {
  control: Control<RubricFormValues>;
  name: FieldPath<RubricFormValues>;
  label: string;
  options: [string, string][];
}) {
  return (
    <FormField
      control={control}
      name={name}
      render={({ field }) => (
        <FormItem>
          <FormLabel>{label}</FormLabel>
          <Select value={field.value as string} onValueChange={field.onChange}>
            <FormControl>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
            </FormControl>
            <SelectContent>
              {options.map(([v, l]) => (
                <SelectItem key={v} value={v}>
                  {l}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <FormMessage />
        </FormItem>
      )}
    />
  );
}

function SwitchField({ control, name, label, help }: { control: Control<RubricFormValues>; name: FieldPath<RubricFormValues>; label: string; help?: string }) {
  return (
    <FormField
      control={control}
      name={name}
      render={({ field }) => (
        <FormItem className="content-start">
          <div className="flex items-center gap-2 pt-6">
            <FormControl>
              <Switch checked={field.value as boolean} onCheckedChange={field.onChange} />
            </FormControl>
            <FormLabel className="font-normal">{label}</FormLabel>
          </div>
          {help && <FormDescription>{help}</FormDescription>}
        </FormItem>
      )}
    />
  );
}
