"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowUpRight, KeyRound, Lock, MoreHorizontal, Pause, Play, Plus, ShieldCheck, Trash2, TriangleAlert, Users, Webhook } from "lucide-react";
import { EmptyState } from "@/components/app/empty-state";
import { FormAlert } from "@/components/auth/form-alert";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { CopyButton } from "@/components/ui/copy-button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatDate, formatDateTime, initials } from "@/lib/format";
import {
  addWebhook,
  changeRole,
  createApiKey,
  deleteWebhook,
  inviteMember,
  removeMember,
  revokeApiKey,
  setAllowExternalModels,
  setWebhookActive,
} from "./actions";

type Role = "owner" | "admin" | "reviewer";
type Key = { id: string; name: string; prefix: string; created_at: string; last_used_at: string | null; revoked_at: string | null };
type Hook = { id: string; url: string; active: boolean; created_at: string };
export type MemberView = { userId: string; role: Role; email: string | null; name: string | null; joinedAt: string; pending: boolean };

type Props = {
  initialTab: string;
  canEdit: boolean;
  myRole: Role;
  myUserId: string;
  keys: Key[];
  hooks: Hook[];
  members: MemberView[];
  allowExternal: boolean;
  trainingOptIn: boolean;
};

const NETWORK = "We could not reach Ormes. Check your connection.";

export function SettingsTabs(props: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const [tab, setTab] = useState(props.initialTab);
  return (
    <Tabs
      value={tab}
      onValueChange={(t) => {
        setTab(t);
        router.replace(`${pathname}?tab=${t}`, { scroll: false });
      }}
    >
      <TabsList>
        <TabsTrigger value="api-keys">
          <KeyRound aria-hidden />
          API keys
        </TabsTrigger>
        <TabsTrigger value="webhooks">
          <Webhook aria-hidden />
          Webhooks
        </TabsTrigger>
        <TabsTrigger value="team">
          <Users aria-hidden />
          Team
        </TabsTrigger>
        <TabsTrigger value="privacy">
          <ShieldCheck aria-hidden />
          Data &amp; privacy
        </TabsTrigger>
      </TabsList>
      {!props.canEdit && (
        <FormAlert tone="info" className="mt-6">
          <span className="inline-flex items-center gap-1.5">
            <Lock className="size-3.5" aria-hidden />
            You are a reviewer. Only owners and admins can change settings.
          </span>
        </FormAlert>
      )}
      <TabsContent value="api-keys">
        <ApiKeys keys={props.keys} canEdit={props.canEdit} />
      </TabsContent>
      <TabsContent value="webhooks">
        <Webhooks hooks={props.hooks} canEdit={props.canEdit} />
      </TabsContent>
      <TabsContent value="team">
        <Team members={props.members} canEdit={props.canEdit} myRole={props.myRole} myUserId={props.myUserId} />
      </TabsContent>
      <TabsContent value="privacy">
        <Privacy allowExternal={props.allowExternal} trainingOptIn={props.trainingOptIn} canEdit={props.canEdit} />
      </TabsContent>
    </Tabs>
  );
}

function SectionHead({ title, description, action }: { title: string; description: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h2 className="text-[16px] font-medium">{title}</h2>
        <p className="mt-1 max-w-[62ch] text-[13.5px] text-muted-foreground">{description}</p>
      </div>
      {action}
    </div>
  );
}

/** A secret shown exactly once, with a copy button and a clear warning. */
function OneTimeSecret({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-2">
      <Label>{label}</Label>
      <div className="flex items-center gap-2 rounded-lg border border-border bg-subtle p-2 pl-3">
        <code className="min-w-0 flex-1 break-all font-mono text-[12.5px]" data-testid="one-time-secret">
          {value}
        </code>
        <CopyButton value={value} />
      </div>
      <p className="flex items-start gap-1.5 text-[13px] text-review-fg">
        <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
        Copy it now and store it somewhere safe. We only keep a hash, so it cannot be shown again.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------- API keys

function ApiKeys({ keys, canEdit }: { keys: Key[]; canEdit: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [revoking, setRevoking] = useState<Key | null>(null);
  const [revokePending, startRevoke] = useTransition();

  const create = () =>
    start(async () => {
      setError(null);
      const res = await createApiKey(name).catch(() => ({ ok: false as const, error: NETWORK }));
      if (!res.ok) return setError(res.error);
      setCreated(res.key);
      router.refresh();
    });

  const close = (o: boolean) => {
    if (pending) return;
    setOpen(o);
    if (!o) {
      setName("");
      setError(null);
      setCreated(null);
    }
  };

  return (
    <section>
      <SectionHead
        title="API keys"
        description={
          <>
            Send <code className="font-mono text-[12.5px] text-foreground">Authorization: Bearer orm_live_…</code> to <code className="font-mono text-[12.5px] text-foreground">/api/v1</code>. We store only a hash of each key.
          </>
        }
        action={
          canEdit && (
            <Button onClick={() => setOpen(true)}>
              <Plus aria-hidden />
              Create key
            </Button>
          )
        }
      />
      {keys.length === 0 ? (
        <EmptyState icon={KeyRound} title="No API keys yet" description="Create a key to send videos from your platform to Ormes." />
      ) : (
        <div className="overflow-hidden rounded-xl border border-border">
          <Table>
            <TableHeader className="bg-subtle">
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead className="hidden sm:table-cell">Key</TableHead>
                <TableHead className="hidden md:table-cell">Created</TableHead>
                <TableHead className="hidden md:table-cell">Last used</TableHead>
                <TableHead className="w-0" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {keys.map((k) => (
                <TableRow key={k.id}>
                  <TableCell className="font-medium">
                    {k.name}
                    <span className="block font-mono text-[12px] font-normal text-muted-foreground sm:hidden">{k.prefix}…</span>
                  </TableCell>
                  <TableCell className="hidden font-mono text-[12.5px] text-muted-foreground sm:table-cell">{k.prefix}…</TableCell>
                  <TableCell className="hidden text-[13px] text-muted-foreground md:table-cell">{formatDate(k.created_at)}</TableCell>
                  <TableCell className="hidden text-[13px] text-muted-foreground md:table-cell">{k.last_used_at ? formatDateTime(k.last_used_at) : "Never"}</TableCell>
                  <TableCell className="text-right">
                    {k.revoked_at ? (
                      <Badge tone="reject">revoked</Badge>
                    ) : canEdit ? (
                      <Button variant="secondary" size="sm" onClick={() => setRevoking(k)}>
                        Revoke
                      </Button>
                    ) : (
                      <Badge tone="accept">active</Badge>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <Dialog open={open} onOpenChange={close}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{created ? "Your new API key" : "Create an API key"}</DialogTitle>
            <DialogDescription>{created ? "Use it in the Authorization header of every request." : "Name it after where it will be used, so you know what to revoke later."}</DialogDescription>
          </DialogHeader>
          {created ? (
            <OneTimeSecret label="API key" value={created} />
          ) : (
            <form
              id="create-key"
              className="grid gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                create();
              }}
            >
              <Label htmlFor="key-name">Name</Label>
              <Input id="key-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={100} placeholder="Production ingest" autoFocus aria-invalid={Boolean(error)} />
              {error && <p className="text-[13px] text-destructive" role="alert">{error}</p>}
            </form>
          )}
          <DialogFooter>
            {created ? (
              <Button onClick={() => close(false)}>I have copied it</Button>
            ) : (
              <>
                <Button variant="secondary" onClick={() => close(false)} disabled={pending}>
                  Cancel
                </Button>
                <Button type="submit" form="create-key" loading={pending}>
                  Create key
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={revoking !== null} onOpenChange={(o) => !o && !revokePending && setRevoking(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Revoke “{revoking?.name}”?</AlertDialogTitle>
            <AlertDialogDescription>
              Requests using <span className="font-mono text-foreground">{revoking?.prefix}…</span> will fail immediately with 401. This cannot be undone; create a new key to replace it.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={revokePending}>Cancel</AlertDialogCancel>
            <Button
              variant="destructive"
              loading={revokePending}
              onClick={() =>
                startRevoke(async () => {
                  const res = await revokeApiKey(revoking!.id).catch(() => ({ ok: false as const, error: NETWORK }));
                  if (!res.ok) return void toast.error(res.error);
                  toast.success(`Key “${revoking!.name}” revoked`);
                  setRevoking(null);
                  router.refresh();
                })
              }
            >
              Revoke key
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}

// ---------------------------------------------------------------- Webhooks

function Webhooks({ hooks, canEdit }: { hooks: Hook[]; canEdit: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [deleting, setDeleting] = useState<Hook | null>(null);
  const [deletePending, startDelete] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);

  const close = (o: boolean) => {
    if (pending) return;
    setOpen(o);
    if (!o) {
      setUrl("");
      setError(null);
      setSecret(null);
    }
  };

  const toggle = async (h: Hook) => {
    setBusyId(h.id);
    const res = await setWebhookActive(h.id, !h.active).catch(() => ({ ok: false as const, error: NETWORK }));
    setBusyId(null);
    if (!res.ok) return toast.error(res.error);
    toast.success(h.active ? "Webhook paused" : "Webhook resumed");
    router.refresh();
  };

  return (
    <section>
      <SectionHead
        title="Webhooks"
        description={
          <>
            We send <code className="font-mono text-[12.5px] text-foreground">video.decided</code> to these URLs, signed with HMAC-SHA256 so you can check it came from us.
          </>
        }
        action={
          canEdit && (
            <Button onClick={() => setOpen(true)}>
              <Plus aria-hidden />
              Add webhook
            </Button>
          )
        }
      />
      {hooks.length === 0 ? (
        <EmptyState icon={Webhook} title="No webhooks yet" description="Add one to receive each decision as soon as it is made, instead of polling the API." />
      ) : (
        <ul className="divide-y divide-border rounded-xl border border-border">
          {hooks.map((h) => (
            <li key={h.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <span className="min-w-0 flex-1">
                <span className="block truncate font-mono text-[13px]">{h.url}</span>
                <span className="text-[12.5px] text-muted-foreground">Added {formatDate(h.created_at)}</span>
              </span>
              <Badge tone={h.active ? "accept" : "neutral"}>{h.active ? "active" : "paused"}</Badge>
              {canEdit && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${h.url}`} loading={busyId === h.id}>
                      <MoreHorizontal aria-hidden />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onSelect={() => void toggle(h)}>
                      {h.active ? <Pause aria-hidden /> : <Play aria-hidden />}
                      {h.active ? "Pause" : "Resume"}
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => setDeleting(h)} className="text-destructive [&_svg]:!text-destructive">
                      <Trash2 aria-hidden />
                      Delete
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </li>
          ))}
        </ul>
      )}

      <Dialog open={open} onOpenChange={close}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{secret ? "Webhook added" : "Add a webhook"}</DialogTitle>
            <DialogDescription>
              {secret ? "Verify the Ormes-Signature header of each delivery with this signing secret." : "An https endpoint on your side that accepts POST requests."}
            </DialogDescription>
          </DialogHeader>
          {secret ? (
            <OneTimeSecret label="Signing secret" value={secret} />
          ) : (
            <form
              id="add-webhook"
              className="grid gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                start(async () => {
                  setError(null);
                  const res = await addWebhook(url).catch(() => ({ ok: false as const, error: NETWORK }));
                  if (!res.ok) return setError(res.error);
                  setSecret(res.secret);
                  router.refresh();
                });
              }}
            >
              <Label htmlFor="hook-url">Endpoint URL</Label>
              <Input
                id="hook-url"
                type="url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://example.com/hooks/ormes"
                className="font-mono text-[13px]"
                autoFocus
                aria-invalid={Boolean(error)}
              />
              {error && <p className="text-[13px] text-destructive" role="alert">{error}</p>}
            </form>
          )}
          <DialogFooter>
            {secret ? (
              <Button onClick={() => close(false)}>I have copied it</Button>
            ) : (
              <>
                <Button variant="secondary" onClick={() => close(false)} disabled={pending}>
                  Cancel
                </Button>
                <Button type="submit" form="add-webhook" loading={pending}>
                  Add webhook
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleting !== null} onOpenChange={(o) => !o && !deletePending && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this webhook?</AlertDialogTitle>
            <AlertDialogDescription>
              <span className="break-all font-mono text-foreground">{deleting?.url}</span> will stop receiving decisions. To stop temporarily, pause it instead.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deletePending}>Cancel</AlertDialogCancel>
            <Button
              variant="destructive"
              loading={deletePending}
              onClick={() =>
                startDelete(async () => {
                  const res = await deleteWebhook(deleting!.id).catch(() => ({ ok: false as const, error: NETWORK }));
                  if (!res.ok) return void toast.error(res.error);
                  toast.success("Webhook deleted");
                  setDeleting(null);
                  router.refresh();
                })
              }
            >
              Delete webhook
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}

// ---------------------------------------------------------------- Team

const ROLE_HELP: Record<Role, string> = {
  owner: "Everything, including other owners",
  admin: "Rubrics, settings, team",
  reviewer: "Review videos and contests",
};

function Team({ members, canEdit, myRole, myUserId }: { members: MemberView[]; canEdit: boolean; myRole: Role; myUserId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("reviewer");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [removing, setRemoving] = useState<MemberView | null>(null);
  const [removePending, startRemove] = useTransition();
  const roles: Role[] = myRole === "owner" ? ["owner", "admin", "reviewer"] : ["admin", "reviewer"];

  const updateRole = async (m: MemberView, r: Role) => {
    const res = await changeRole(m.userId, r).catch(() => ({ ok: false as const, error: NETWORK }));
    if (!res.ok) return toast.error(res.error);
    toast.success(`${m.name ?? m.email} is now ${r}`);
    router.refresh();
  };

  return (
    <section>
      <SectionHead
        title="Team"
        description="Everyone here can review videos and contests. Admins and owners also manage rubrics and settings."
        action={
          canEdit && (
            <Button onClick={() => setOpen(true)}>
              <Plus aria-hidden />
              Invite
            </Button>
          )
        }
      />
      <ul className="divide-y divide-border rounded-xl border border-border">
        {members.map((m) => {
          const editable = canEdit && m.userId !== myUserId && (m.role !== "owner" || myRole === "owner");
          return (
            <li key={m.userId} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <span className="grid size-8 shrink-0 place-items-center rounded-full bg-muted text-[12px] font-medium">{initials(m.name ?? undefined, m.email ?? undefined)}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[14px] font-medium">
                  {m.name ?? m.email ?? "Unknown user"}
                  {m.userId === myUserId && <span className="font-normal text-muted-foreground"> (you)</span>}
                </span>
                <span className="block truncate text-[12.5px] text-muted-foreground">
                  {m.name ? m.email : null}
                  {m.pending ? " · invitation sent" : ` · joined ${formatDate(m.joinedAt)}`}
                </span>
              </span>
              {editable ? (
                <>
                  <Select value={m.role} onValueChange={(r) => void updateRole(m, r as Role)}>
                    <SelectTrigger className="w-32" aria-label={`Role of ${m.name ?? m.email}`}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent align="end">
                      {roles.map((r) => (
                        <SelectItem key={r} value={r}>
                          <span className="capitalize">{r}</span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button variant="ghost" size="icon-sm" aria-label={`Remove ${m.name ?? m.email}`} onClick={() => setRemoving(m)}>
                    <Trash2 aria-hidden />
                  </Button>
                </>
              ) : (
                <Badge tone="outline" className="capitalize">
                  {m.role}
                </Badge>
              )}
            </li>
          );
        })}
      </ul>

      <Dialog open={open} onOpenChange={(o) => !pending && (setOpen(o), o || (setEmail(""), setError(null)))}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Invite someone</DialogTitle>
            <DialogDescription>We email them a link to set a password and join this organization.</DialogDescription>
          </DialogHeader>
          <form
            id="invite"
            className="grid gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              start(async () => {
                setError(null);
                const res = await inviteMember(email, role).catch(() => ({ ok: false as const, error: NETWORK }));
                if (!res.ok) return setError(res.error);
                toast.success(res.existing ? `${email} was added to the team` : `Invitation sent to ${email}`);
                setOpen(false);
                setEmail("");
                router.refresh();
              });
            }}
          >
            <div className="grid gap-2">
              <Label htmlFor="invite-email">Work email</Label>
              <Input id="invite-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="colleague@company.com" autoFocus aria-invalid={Boolean(error)} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="invite-role">Role</Label>
              <Select value={role} onValueChange={(r) => setRole(r as Role)}>
                <SelectTrigger id="invite-role">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {roles.map((r) => (
                    <SelectItem key={r} value={r}>
                      <span className="capitalize">{r}</span> <span className="text-muted-foreground">· {ROLE_HELP[r]}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {error && <FormAlert>{error}</FormAlert>}
          </form>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setOpen(false)} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" form="invite" loading={pending}>
              Send invitation
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={removing !== null} onOpenChange={(o) => !o && !removePending && setRemoving(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove {removing?.name ?? removing?.email}?</AlertDialogTitle>
            <AlertDialogDescription>They lose access to this organization right away. Their past reviews stay in the history.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={removePending}>Cancel</AlertDialogCancel>
            <Button
              variant="destructive"
              loading={removePending}
              onClick={() =>
                startRemove(async () => {
                  const res = await removeMember(removing!.userId).catch(() => ({ ok: false as const, error: NETWORK }));
                  if (!res.ok) return void toast.error(res.error);
                  toast.success("Removed from the team");
                  setRemoving(null);
                  router.refresh();
                })
              }
            >
              Remove
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}

// ---------------------------------------------------------------- Data & privacy

function Privacy({ allowExternal, trainingOptIn, canEdit }: { allowExternal: boolean; trainingOptIn: boolean; canEdit: boolean }) {
  const router = useRouter();
  const [value, setValue] = useState(allowExternal);
  const [pending, start] = useTransition();
  const change = (next: boolean) => {
    setValue(next);
    start(async () => {
      const res = await setAllowExternalModels(next).catch(() => ({ ok: false as const, error: NETWORK }));
      if (!res.ok) {
        setValue(!next);
        return void toast.error(res.error);
      }
      toast.success(next ? "Third-party models allowed" : "Third-party models turned off");
      router.refresh();
    });
  };
  return (
    <section className="grid gap-4">
      <SectionHead title="Data & privacy" description="How Ormes handles your contributors' videos. These rules apply to every video, in every decision." />
      <Card className="grid gap-4 p-5">
        <div className="flex items-start justify-between gap-6">
          <div className="grid gap-1.5">
            <Label htmlFor="external-models" className="text-[15px]">
              Allow third-party models
            </Label>
            <p className="max-w-[60ch] text-[13.5px] text-muted-foreground">
              Off by default. Your videos are analysed by Ormes&apos;s own models. When on, we may send a video to Google Gemini or TwelveLabs for tasks our models do not cover yet. Each
              decision records which model produced each measurement.
            </p>
          </div>
          <Switch id="external-models" checked={value} onCheckedChange={change} disabled={!canEdit || pending} />
        </div>
      </Card>
      <Card className="grid gap-3 p-5">
        <div className="flex items-start justify-between gap-6">
          <div className="grid gap-1.5">
            <h3 className="text-[15px] font-medium">Training on your videos</h3>
            <p className="max-w-[60ch] text-[13.5px] text-muted-foreground">
              {trainingOptIn
                ? "Your organization opted in: your videos train Ormes's own models only, never anyone else's. Contact us to opt out; it applies to every future video."
                : "Never. Your videos are not used to train any model, resold or shown to another customer. Opting in is a separate agreement, with a discount, and only trains Ormes's own models."}
            </p>
          </div>
          <Badge tone={trainingOptIn ? "review" : "accept"}>{trainingOptIn ? "opted in" : "off"}</Badge>
        </div>
      </Card>
      <Card className="grid gap-3 p-5">
        <h3 className="text-[15px] font-medium">Retention</h3>
        <ul className="grid gap-1.5 pl-5 text-[13.5px] text-muted-foreground">
          <li className="list-disc">Videos are deleted from storage right after the analysis.</li>
          <li className="list-disc">A video sent to review is kept until a person decides it, at most 14 days, then deleted anyway.</li>
          <li className="list-disc">A video that fails processing is deleted after the last attempt.</li>
          <li className="list-disc">We keep the decision, its reasons, every measurement, the rubric version, reviewer overrides and lab outcomes.</li>
          <li className="list-disc">Fingerprints that cannot be turned back into video are kept to catch re-uploads, within your organization only.</li>
        </ul>
        <div className="flex flex-wrap gap-2 pt-1">
          <Button asChild variant="secondary" size="sm">
            <Link href="/data">
              How we handle data
              <ArrowUpRight aria-hidden />
            </Link>
          </Button>
          <Button asChild variant="secondary" size="sm">
            <Link href="/dpa">
              Data processing agreement
              <ArrowUpRight aria-hidden />
            </Link>
          </Button>
        </div>
      </Card>
    </section>
  );
}
