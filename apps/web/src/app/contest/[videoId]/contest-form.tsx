"use client";

import { useState } from "react";
import { button, input } from "@/components/ui";

export function ContestForm({ videoId }: { videoId: string }) {
  const [message, setMessage] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "done">("idle");
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setState("sending");
    setError(null);
    const res = await fetch(`/api/contest/${videoId}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message }),
    });
    if (res.ok) return setState("done");
    const body = await res.json().catch(() => null);
    setError(body?.error?.message ?? "Something went wrong");
    setState("idle");
  }

  if (state === "done") {
    return <p className="text-sm text-emerald-700 dark:text-emerald-400">Thanks. Your message was sent for review.</p>;
  }
  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <textarea
        required
        maxLength={4000}
        rows={5}
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        className={input}
        placeholder="What should we know about this video?"
      />
      <button disabled={state === "sending"} className={button("primary") + " self-start"}>
        {state === "sending" ? "Sending…" : "Send"}
      </button>
      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
    </form>
  );
}
