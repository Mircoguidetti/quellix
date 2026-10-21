"use client";

import { useState } from "react";
import { addWebhook, createApiKey } from "./actions";
import { button, card, input, muted } from "@/components/ui";

function Secret({ label, value }: { label: string; value: string }) {
  return (
    <div className={card + " border-amber-300 dark:border-amber-700"}>
      <p className="text-sm font-medium">{label}</p>
      <p className={"text-xs " + muted}>Copy it now. It will not be shown again.</p>
      <code className="mt-2 block break-all rounded bg-zinc-100 p-2 text-xs dark:bg-zinc-900">{value}</code>
    </div>
  );
}

export function NewKeyForm() {
  const [key, setKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="flex flex-col gap-3">
      <form
        action={async (fd) => {
          const res = await createApiKey(fd);
          if (res.ok) {
            setKey(res.key);
            setError(null);
          } else setError(res.error);
        }}
        className="flex flex-wrap gap-2"
      >
        <input name="name" required maxLength={100} placeholder="Key name, e.g. production" className={input + " !w-auto min-w-56 flex-1"} />
        <button className={button("primary")}>Create key</button>
      </form>
      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      {key && <Secret label="Your new API key" value={key} />}
    </div>
  );
}

export function NewWebhookForm() {
  const [secret, setSecret] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="flex flex-col gap-3">
      <form
        action={async (fd) => {
          const res = await addWebhook(fd);
          if (res.ok) {
            setSecret(res.secret);
            setError(null);
          } else setError(res.error);
        }}
        className="flex flex-wrap gap-2"
      >
        <input name="url" type="url" required placeholder="https://example.com/quellix-webhook" className={input + " !w-auto min-w-56 flex-1"} />
        <button className={button("primary")}>Add webhook</button>
      </form>
      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      {secret && <Secret label="Signing secret" value={secret} />}
    </div>
  );
}
