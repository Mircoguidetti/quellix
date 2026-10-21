import { dashboardContext } from "@/lib/dashboard";
import { deleteWebhook, revokeApiKey, setAllowExternalModels, toggleWebhook } from "./actions";
import { NewKeyForm, NewWebhookForm } from "./secret-forms";
import { badge, button, card, muted } from "@/components/ui";

export const metadata = { title: "Settings · Quellix" };

const when = (iso: string | null) => (iso ? new Date(iso).toISOString().slice(0, 16).replace("T", " ") : "never");

export default async function SettingsPage() {
  const { db, orgId, session } = await dashboardContext();
  const canEdit = session.role !== "reviewer";
  const [{ data: keys }, { data: hooks }, { data: org }] = await Promise.all([
    db.from("api_keys").select("id, name, prefix, created_at, last_used_at, revoked_at").eq("org_id", orgId).order("created_at", { ascending: false }),
    db.from("webhooks").select("id, url, active, created_at").eq("org_id", orgId).order("created_at", { ascending: false }),
    db.from("organizations").select("allow_external_models").eq("id", orgId).single(),
  ]);
  const allowExternal = org?.allow_external_models === true;

  return (
    <div className="flex flex-col gap-8">
      <h1 className="text-xl font-semibold tracking-tight">Settings</h1>

      <section className="flex flex-col gap-3">
        <h2 className="font-medium">Third-party models</h2>
        <form action={setAllowExternalModels} className={card + " flex flex-col gap-3 text-sm"}>
          <input type="hidden" name="allow" value={String(!allowExternal)} />
          <p>
            Allow third-party models (Gemini, TwelveLabs) to analyse our videos:{" "}
            <span className={badge(allowExternal ? "review" : "accept")}>{allowExternal ? "on" : "off"}</span>
          </p>
          <p className={muted}>
            Off by default. When off, your videos are only analysed by Quellix&apos;s own models. Turning it on lets us send
            videos to these providers for tasks our own models do not cover yet.
          </p>
          {canEdit ? (
            <button className={button("secondary") + " self-start"}>{allowExternal ? "Turn off" : "Turn on"}</button>
          ) : (
            <p className={muted}>Only owners and admins can change this.</p>
          )}
        </form>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="font-medium">API keys</h2>
        <p className={"text-sm " + muted}>
          Send as <code>Authorization: Bearer qx_live_…</code> to <code>/api/v1</code>. Only a hash is stored.
        </p>
        {canEdit && <NewKeyForm />}
        <ul className="flex flex-col divide-y divide-zinc-200 rounded-lg border border-zinc-200 text-sm dark:divide-zinc-800 dark:border-zinc-800">
          {(keys ?? []).length === 0 && <li className={"px-4 py-3 " + muted}>No keys yet.</li>}
          {(keys ?? []).map((k) => (
            <li key={k.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3">
              <span className="font-medium">{k.name}</span>
              <code className="text-xs">{k.prefix}…</code>
              <span className={"text-xs " + muted}>created {when(k.created_at)}</span>
              <span className={"text-xs " + muted}>last used {when(k.last_used_at)}</span>
              <span className="flex-1" />
              {k.revoked_at ? (
                <span className={badge("reject")}>revoked</span>
              ) : (
                canEdit && (
                  <form action={revokeApiKey}>
                    <input type="hidden" name="id" value={k.id} />
                    <button className={button("secondary")}>Revoke</button>
                  </form>
                )
              )}
            </li>
          ))}
        </ul>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="font-medium">Webhooks</h2>
        <p className={"text-sm " + muted}>
          Where decisions are sent (<code>video.decided</code>). We store the URLs; delivery is done by the analysis worker.
        </p>
        {canEdit && <NewWebhookForm />}
        <ul className="flex flex-col divide-y divide-zinc-200 rounded-lg border border-zinc-200 text-sm dark:divide-zinc-800 dark:border-zinc-800">
          {(hooks ?? []).length === 0 && <li className={"px-4 py-3 " + muted}>No webhooks yet.</li>}
          {(hooks ?? []).map((h) => (
            <li key={h.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <span className="min-w-0 flex-1 truncate">{h.url}</span>
              <span className={badge(h.active ? "accept" : "neutral")}>{h.active ? "active" : "paused"}</span>
              {canEdit && (
                <>
                  <form action={toggleWebhook}>
                    <input type="hidden" name="id" value={h.id} />
                    <input type="hidden" name="active" value={String(!h.active)} />
                    <button className={button("secondary")}>{h.active ? "Pause" : "Resume"}</button>
                  </form>
                  <form action={deleteWebhook}>
                    <input type="hidden" name="id" value={h.id} />
                    <button className={button("secondary")}>Delete</button>
                  </form>
                </>
              )}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
